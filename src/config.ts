// Where an agent's identity comes from.
//
// Two people installing the plugin and both getting the handle `claude` is not
// a cosmetic problem: the browser cannot tell them apart, one of them is hidden
// from the room, and a comment saying `@claude` wakes both of them to answer
// over each other. So the handle has to be something each installer sets, and
// the plugin has to ask for it at install time rather than hoping somebody
// reads a README.
//
// That gives two ways in, and both have to work:
//
//   * `PAIRDOWN_*` in the environment — how a script, a test, or anyone running
//     the server by hand sets it. This is the canonical name.
//   * `CLAUDE_PLUGIN_OPTION_*` — what Claude Code exports to an MCP subprocess
//     for each value declared in the plugin manifest's `userConfig`. Sensitive
//     values arrive only this way, because they are deliberately not allowed
//     into `${user_config.*}` substitution in .mcp.json.
//
// The environment wins, and that is why .mcp.json declares no `env` block. An
// env block there is applied to the subprocess directly, so mapping
// `${user_config.agent_handle}` onto PAIRDOWN_AGENT overwrote the variable a
// user had set for themselves — the plugin's setting silently beat the more
// specific one. Reading the plugin values under their own names instead leaves
// a per-session override actually able to override.
//
// Read late rather than at import, because tests and the smoke harness set the
// environment after this module is first loaded.

/** A setting, from its own environment variable or from the plugin's user configuration. */
function setting(envName: string, optionKey: string): string | undefined {
  return (
    process.env[envName] ||
    process.env[`CLAUDE_PLUGIN_OPTION_${optionKey}`] ||
    undefined
  );
}

/** What people type after `@` to summon this agent. */
export const agentHandle = (): string =>
  (setting("PAIRDOWN_AGENT", "AGENT_HANDLE") ?? "claude").toLowerCase();

/** Whose agent this is. Shown beside the handle; never used as the handle itself, which has to stay unambiguous to type. */
export const agentOwner = (): string | undefined => setting("PAIRDOWN_OWNER", "OWNER");

/** The room server to attach to. */
export const roomUrl = (): string => setting("PAIRDOWN_URL", "SERVER_URL") ?? "ws://127.0.0.1:8790";

/** The shared key, when the room server is behind one. Sensitive, so it only ever arrives as an environment variable. */
export const sharedKey = (): string | undefined => setting("PAIRDOWN_SECRET", "SHARED_KEY");
