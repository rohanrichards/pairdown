// A shared-secret gate for the whole server.
//
// This exists for one job: putting a room behind a Cloudflare tunnel for a
// supervised demo without exposing every room on the machine to whoever finds
// the URL. It is authentication, not authorisation — one secret, so everybody
// who has it is the same principal, nobody can be told apart, and nobody can be
// revoked individually. Do not mistake it for auth, and do not leave it running.
//
// Three details are what make it real rather than decorative:
//
//   * The comparison is constant-time. A `===` on a secret leaks it a byte at a
//     time to anyone who can measure response times.
//   * The cookie carries a value derived from the secret, never the secret. A
//     cookie is readable by anything that can read the jar; the secret is what
//     unlocks every other room too.
//   * The websocket upgrade is gated with everything else. The document travels
//     over /ws, so gating the HTML and not the socket locks the door and leaves
//     the window open — the exact mistake this kind of gate usually ships with.
//
// The server binds 127.0.0.1, and cloudflared reaches it over loopback, so
// loopback cannot be exempt: an exemption for localhost would be an exemption
// for the tunnel, which is the whole of the internet.
import { timingSafeEqual, createHmac } from "node:crypto";

export const COOKIE = "pd_session";

/** True when a secret is configured and the gate should be enforced. */
export function gateEnabled(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length > 0;
}

/** Constant-time string comparison. Length is compared first and does leak, which is harmless for a fixed-length token. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  if (ab.length === 0) return true;
  return timingSafeEqual(ab, bb);
}

/**
 * The value the session cookie carries: an HMAC of a fixed label under the
 * secret. Deterministic, so no server-side session store is needed, and it
 * cannot be reversed into the secret if a cookie leaks.
 */
export function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update("pairdown/session/v1").digest("hex");
}

/** Read one cookie out of a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Is this request allowed through?
 *
 * Two ways in: a session cookie, which is how a browser presents itself after
 * the gate, and `Authorization: Bearer <secret>`, which is how the agent's
 * websocket and any script presents itself, since neither has a cookie jar.
 */
export function authorised(req: Request, secret: string): boolean {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return safeEqual(auth.slice(7).trim(), secret);
  const tok = readCookie(req.headers.get("cookie"), COOKIE);
  return tok !== null && safeEqual(tok, sessionToken(secret));
}

/** Set-Cookie for a successful unlock. Secure is set only when the request arrived over https, or a plain-http localhost test would silently never keep the cookie. */
export function sessionCookie(secret: string, https: boolean): string {
  const bits = [
    `${COOKIE}=${sessionToken(secret)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=43200",
  ];
  if (https) bits.push("Secure");
  return bits.join("; ");
}

/** True when the request reached us over https, including via a proxy that terminated TLS. */
export function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(req.url).protocol === "https:";
}

/** A local path to return to after unlocking. Anything absolute or protocol-relative is discarded, so the gate cannot be turned into an open redirect. */
export function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function gatePage(returnTo: string, failed: boolean): string {
  const to = returnTo.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pairdown</title>
<style>
  :root { --paper:#f1f4f0; --card:#fbfcfa; --ink:#171c19; --soft:#5d6662;
          --rule:#d5dbd5; --accent:#24479e; --bad:#b0453f;
          --sans:"Archivo",system-ui,sans-serif; --mono:ui-monospace,Menlo,monospace }
  @media (prefers-color-scheme:dark) {
    :root { --paper:#121513; --card:#191d1a; --ink:#e7ebe6; --soft:#99a39d;
            --rule:#2a302c; --accent:#9db8ff; --bad:#e08b85 }
  }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:var(--paper); color:var(--ink); font-family:var(--sans) }
  form { background:var(--card); border:1px solid var(--rule); border-radius:6px;
         padding:1.6rem 1.7rem; width:min(24rem,90vw) }
  h1 { font-size:1rem; margin:0 0 .3rem; letter-spacing:-.01em }
  h1 span { color:var(--soft); font-weight:400 }
  p { font-size:.82rem; color:var(--soft); line-height:1.5; margin:0 0 1.1rem }
  label { display:block; font-family:var(--mono); font-size:.62rem;
          letter-spacing:.1em; text-transform:uppercase; color:var(--soft); margin-bottom:.35rem }
  input { width:100%; box-sizing:border-box; font-family:var(--mono); font-size:.9rem;
          padding:.55rem .6rem; border:1px solid var(--rule); border-radius:3px;
          background:var(--paper); color:var(--ink) }
  button { margin-top:.9rem; width:100%; font-family:var(--mono); font-size:.75rem;
           padding:.55rem; border-radius:3px; cursor:pointer;
           background:var(--accent); color:var(--paper); border:1px solid var(--accent) }
  .bad { color:var(--bad); font-size:.78rem; margin:.7rem 0 0 }
</style></head>
<body>
  <form method="POST" action="/gate">
    <h1>pair<span>down</span></h1>
    <p>This room is behind a shared key for a demo. Paste the key you were given.</p>
    <input type="hidden" name="to" value="${to}">
    <label for="key">Key</label>
    <input id="key" name="key" type="password" autocomplete="off" autofocus spellcheck="false">
    <button type="submit">Unlock</button>
    ${failed ? '<p class="bad">That key was not accepted.</p>' : ""}
  </form>
</body></html>`;
}
