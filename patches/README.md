# Distribution-layer patches

This directory contains distribution-layer patches applied to **build artifacts
of official DSH packages only** — never to official source, and never to this
plugin's own code. They add generic extension mechanisms the plugin consumes;
the official default behavior is unchanged when no plugin uses them.

## What `apply.mjs` does

Injects a window-level "workspace-picker menu contribution registry"
(`window.__DSH_WORKSPACE_PICKER_EXTRA_ITEMS__`) into the official
`@deepseek-ai/dsh-client-ui-workspace` client bundle, and makes the picker
menu merge registered entries and dispatch their picks. The browser half of
this plugin registers its "No workspace (read-only session)" entry through
that registry.

## Usage

```sh
node patches/apply.mjs apply     # idempotent; auto-discovers the bundle
node patches/apply.mjs verify    # exit 0 when applied
node patches/apply.mjs revert    # restores the original bundle exactly
```

Target discovery order: explicit path argument →
`DSH_NO_WORKSPACE_UI_BUNDLE` env → `packages/client/ui-workspace/lib/client.js`
relative to the working directory → `<profile>/node_modules/@deepseek-ai/
dsh-client-ui-workspace/lib/client.js` under the resolved DSH home.

## When to re-run

After upgrading or rebuilding the official `dsh-client-ui-workspace` package
(the bundle is regenerated and the injection is lost). `verify` reports
whether the current bundle carries the mechanism.
