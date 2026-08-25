// Where an agent's identity comes from.
//
// Two people installing the plugin and both getting the handle `claude` is not
// a cosmetic problem: the browser cannot tell them apart, one of them is hidden
// from the room, and a comment saying `@claude` wakes both of them to answer
// over each other. So the handle has to be something each installer sets, and
// the plugin has to ask for it at install time rather than hoping somebody
// reads a README.
//
// Three ways in, most specific first:
//
//   * `PAIRDOWN_*` — set by hand, for a script, a test, or a second agent under
//     a different handle for one session. This is the canonical name and it
//     wins.
//   * `PAIRDOWN_PLUGIN_*` — what .mcp.json fills in from the plugin's
//     `userConfig` answers, given at install time.
//   * `CLAUDE_PLUGIN_OPTION_*` — what Claude Code exports for each `userConfig`
//     value. Documented as reaching MCP subprocesses; measured, it does not —
//     an MCP server gets only CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA, while
//     hooks do get the options. Kept because the hook in scripts/ runs on it,
//     and because it costs nothing if that gap ever closes.
//
// The distinct `PAIRDOWN_PLUGIN_*` spelling is the whole point of this file.
// Mapping `${user_config.agent_handle}` straight onto PAIRDOWN_AGENT put the
// plugin's answer into the subprocess environment under the same name the user
// uses, so the install-time setting silently beat the more specific one and
// a per-session override did nothing at all.
//
// Read late rather than at import, because tests and the smoke harness set the
// environment after this module is first loaded.

/** A setting: set by hand, else configured at install, else absent. */
function setting(name: string, optionKey: string): string | undefined {
  return (
    process.env[`PAIRDOWN_${name}`] ||
    process.env[`PAIRDOWN_PLUGIN_${name}`] ||
    process.env[`CLAUDE_PLUGIN_OPTION_${optionKey}`] ||
    undefined
  );
}

/** What people type after `@` to summon this agent. */
export const agentHandle = (): string => (setting("AGENT", "AGENT_HANDLE") ?? "claude").toLowerCase();

/** Whose agent this is. Shown beside the handle; never used as the handle itself, which has to stay unambiguous to type. */
export const agentOwner = (): string | undefined => setting("OWNER", "OWNER");

/** The room server to attach to. */
export const roomUrl = (): string => setting("URL", "SERVER_URL") ?? "ws://127.0.0.1:8790";

/** The shared key, when the room server is behind one. */
export const sharedKey = (): string | undefined => setting("SECRET", "SHARED_KEY");
