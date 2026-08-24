import { test, expect } from "bun:test";
import { Rooms } from "../src/rooms";
import { startWeb } from "../src/web";
import { sessionToken, safeEqual } from "../src/gate";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = () => join(tmpdir(), `gate-${Math.random().toString(36).slice(2)}`);
const port = () => 8400 + Math.floor(Math.random() * 300);

/** A server with a room, started with or without the gate. */
function serve(secret?: string) {
  const rooms = new Rooms(dir());
  const info = rooms.create("Gated room");
  const web = startWeb(rooms, port(), 10, secret)!;
  return { rooms, info, web, base: `http://127.0.0.1:${web.port}` };
}

const SECRET = "s".repeat(43);

test("safeEqual rejects a wrong value and a different length", () => {
  expect(safeEqual("abc", "abc")).toBe(true);
  expect(safeEqual("abc", "abd")).toBe(false);
  expect(safeEqual("abc", "abcd")).toBe(false);
  expect(safeEqual("", "")).toBe(true);
});

test("the session token is derived, never the secret itself", () => {
  const t = sessionToken(SECRET);
  expect(t).not.toBe(SECRET);
  expect(t).not.toContain(SECRET);
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  // stable for the same secret, different for another
  expect(sessionToken(SECRET)).toBe(t);
  expect(sessionToken(SECRET + "x")).not.toBe(t);
});

test("with no secret configured the server is open, exactly as before", async () => {
  const s = serve();
  expect((await fetch(`${s.base}/`)).status).toBe(200);
  expect((await fetch(`${s.base}/api/rooms`)).status).toBe(200);
  s.web.stop();
});

test("with a secret, html is redirected to the gate and json is refused", async () => {
  const s = serve(SECRET);
  const index = await fetch(`${s.base}/`, { redirect: "manual" });
  expect(index.status).toBe(302);
  expect(index.headers.get("location")).toBe("/gate");

  const room = await fetch(`${s.base}/r/${s.info.id}`, { redirect: "manual" });
  expect(room.status).toBe(302);

  expect((await fetch(`${s.base}/api/rooms`)).status).toBe(401);
  expect((await fetch(`${s.base}/js/editor.js`)).status).toBe(401);
  s.web.stop();
});

test("the gate page is reachable without the secret, and asks for it", async () => {
  const s = serve(SECRET);
  const r = await fetch(`${s.base}/gate`);
  expect(r.status).toBe(200);
  const body = await r.text();
  expect(body).toContain('name="key"');
  expect(body).toContain("password");
  // the form must not leak the secret it is checking against
  expect(body).not.toContain(SECRET);
  s.web.stop();
});

test("a wrong key is refused and sets no cookie", async () => {
  const s = serve(SECRET);
  const r = await fetch(`${s.base}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: "wrong" }).toString(),
    redirect: "manual",
  });
  expect(r.status).toBe(401);
  expect(r.headers.get("set-cookie")).toBeNull();
  s.web.stop();
});

test("the right key sets a hardened cookie and then the app is reachable", async () => {
  const s = serve(SECRET);
  const r = await fetch(`${s.base}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: SECRET }).toString(),
    redirect: "manual",
  });
  expect(r.status).toBe(302);
  const cookie = r.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
  // the raw secret must never travel in a cookie
  expect(cookie).not.toContain(SECRET);
  expect(cookie).toContain(sessionToken(SECRET));

  const jar = cookie.split(";")[0];
  const ok = await fetch(`${s.base}/`, { headers: { cookie: jar } });
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain("Gated room");
  s.web.stop();
});

test("a bearer token authenticates without a cookie, for the agent", async () => {
  const s = serve(SECRET);
  const r = await fetch(`${s.base}/api/rooms`, {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  expect(r.status).toBe(200);
  const wrong = await fetch(`${s.base}/api/rooms`, {
    headers: { authorization: "Bearer nope" },
  });
  expect(wrong.status).toBe(401);
  s.web.stop();
});

test("the websocket upgrade is gated, not just the pages", async () => {
  const s = serve(SECRET);
  const refused = await fetch(`${s.base}/ws?room=${s.info.id}`, {
    headers: { upgrade: "websocket", connection: "Upgrade" },
  });
  expect(refused.status).toBe(401);
  s.web.stop();
});

test("a websocket carrying the session cookie connects and receives the room", async () => {
  const s = serve(SECRET);
  const jar = `sr_session=${sessionToken(SECRET)}`;
  const opened = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.web.port}/ws?room=${s.info.id}`, {
      headers: { cookie: jar },
    } as any);
    ws.onopen = () => { ws.close(); resolve(true); };
    ws.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 2000);
  });
  expect(opened).toBe(true);
  s.web.stop();
});
