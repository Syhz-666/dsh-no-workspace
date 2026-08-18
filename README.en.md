<h1 align="center">dsh-no-workspace</h1>

<p align="center">
  <strong>A plugin that provides read-only sessions for DeepSeek Harness.</strong><br>
  Start without choosing a workspace; once chosen, read-only forever.
</p>

<p align="center"><sub>A community plugin, not an official DeepSeek product. <a href="README.md">中文</a> · English</sub></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms">
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/dsh-plugin-4D6BFE?style=flat" alt="dsh-plugin"></a>
</p>

## What is this

`dsh-no-workspace` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin: it adds a "**No workspace (read-only session)**" entry to the workspace picker and a "**Read-only session**" mode. Whichever entry point you use, the session is structurally locked to read-only — conversation, web search, session history, and task/goal tracking only; file access is controlled (relative paths inside the isolated directory skip approval, every other read is approved per call), with no shell, no write tools, and no subagents.

## Key features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>No workspace (read-only session)</h3>
      <p>An entry in the workspace-picker menu: one click creates a workspace-less session and jumps into it. The session's working directory is an empty isolated directory under <code>$DSH_HOME/.dsh-no-workspace/&lt;sessionId&gt;/</code>.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Structurally locked read-only</h3>
      <p>The moment a session becomes read-only, a zero-length <code>turn/start</code>+<code>turn/end</code> pair makes it permanently non-blank, so the official preset-switch guard refuses every later composition change — the tool surface cannot be escalated.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Read-only session mode</h3>
      <p>"Read-only session" also appears in the mode picker, so an existing session can be switched onto it (locked immediately, the same way). The <code>/readonly-session</code> command works as well.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Zero coupling to official builds</h3>
      <p>No official source, build artifact, or service is modified or decorated. The menu entry is injected into the official bundle in memory by an exact route at serve time; rebuilding, upgrading, or running <code>pnpm install</code> on the official packages needs no replay step.</p>
    </td>
  </tr>
</table>

## Installation

Prerequisite: a **built** checkout of the official dsh project on this machine (run `pnpm install && pnpm run build` inside it). Replace `<repo-url>` and `<dsh-project-dir>` with the actual paths — do not copy the placeholders literally.

```sh
# 1. Get the plugin source
git clone <repo-url> dsh-no-workspace
cd dsh-no-workspace

# 2. Build the plugin
pnpm install && pnpm run build
```

```sh
# 3. Install into the web profile (run inside the official dsh project; the command comes from the dsh CLI)
cd <dsh-project-dir>
pnpm dsh plugin --profile web add <absolute-path-to-the-plugin-directory>
```

```sh
# 4. Restart dsh web and hard-refresh the browser (Ctrl+F5)
pnpm dsh web
```

Notes:

- Step 3 registers the plugin in `$DSH_HOME/profiles/web` (`$DSH_HOME` defaults to `~/.dsh`); the path form is platform-independent;
- On first start the plugin copies `presets/no-workspace` to `$DSH_HOME/.agent-presets/no-workspace/` (idempotent; an edited copy is never overwritten);
- Handing this README together with the repository link to an AI is enough for it to complete the installation by following the four steps — no manual changes to the official project are needed.

## Usage

- Open the workspace picker → "No workspace (read-only session)"; or run the `/readonly-session` command; or create a session and choose "Read-only session" in the mode picker.
- The session is locked as soon as it is selected: a zero-length `turn/start`+`turn/end` pair makes it permanently non-blank, and the official preset-switch guard (`agent-preset-locked`) rejects any preset change from then on.
- Sessions **created** via the "No workspace" menu entry or the `/readonly-session` command default to `deepseek-v4-flash` with `reasoningEffort: 'low'`; the model can be changed manually inside the session at any time. Sessions switched from the mode picker keep their existing model.

## Security model

| Guarantee | Mechanism |
|---|---|
| Tool surface cannot be escalated | The moment a session becomes no-workspace (at creation or during a blank-window switch) a zero-length `turn/start`+`turn/end` pair lands → permanently non-blank → the official preset-switch guard refuses every later switch |
| No writes / no commands | The `no-workspace` preset mounts only read-only tools; the official `tool-fs` (read/write/edit) and shell tools are never mounted |
| Controlled file access | Absolute paths → per-call user approval (fail-closed); relative paths → approval-free only when the session directory sits inside the isolation root (`settings.dsh-no-workspace.isolatedRoot`), otherwise approved the same way; reads without a session directory are rejected outright |
| Permission knobs have no effect | The sandbox mode can be switched, but no write tool consumes a wider mode; read-only is guaranteed by the tool surface |

## Relationship to the official project

This is a community plugin for [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), built on the official plugin mechanism:

- Tools, commands, and presets each stay in their own scope; no official component is overridden;
- The only shared surface is the user preset roster entry (`$DSH_HOME/.agent-presets/no-workspace`), installed idempotently by the plugin;
- The menu entry is injected into the official bundle in memory by an exact host route (reversible; unloading the plugin restores the official route);
- The core agent, models, tools, sessions, Web UI, and plugin ecosystem all come from the official project; this plugin only adds the "read-only session" capability on top.

## Development

```sh
pnpm install
pnpm run build     # tsc (host) + tsdown (host + browser bundle)
pnpm test          # vitest
```

Layout: `src/` (command, isolation, locking, settings, menu injection), `src/tools/` (read-only tools), `src/client/` (menu entry), `presets/` (preset composition). The full design record lives in [docs/design.md](docs/design.md).

## License

[MIT License](LICENSE).

> This is a community plugin for DeepSeek Harness, not an official DeepSeek product. DeepSeek is a trademark of DeepSeek AI.
