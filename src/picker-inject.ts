/**
 * Runtime workspace-picker menu injection: the host half serves the OFFICIAL
 * `@deepseek-ai/dsh-client-ui-workspace` client bundle through an exact
 * webServer route that decorates the bundle text in memory — a window-level
 * "extra menu items" registry the picker menu merges into its items, plus
 * dispatch handling for those ids. Nothing is ever written to the official
 * bundle or its sources, so any rebuild or upgrade of the official package
 * keeps working without a re-apply step. The decoration is an effect:
 * disposal restores the official bundle route. An absent anchor (the official
 * bundle changed shape) serves the bundle untouched and logs — the picker
 * simply shows no extra entries, the plugin degrades to the visible preset
 * and the `/readonly-session` command.
 * @module dsh-no-workspace/picker-inject
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-modules'

/** The registry name the browser half pushes its menu entry into. */
export const PICKER_REGISTRY = 'window.__DSH_WORKSPACE_PICKER_EXTRA_ITEMS__'

/** The official bundle this route decorates. */
export const UI_WORKSPACE_PACKAGE = '@deepseek-ai/dsh-client-ui-workspace'

/** The exact web route path for that bundle. */
const BUNDLE_ROUTE = `/plugins/${UI_WORKSPACE_PACKAGE}/client.js`

// ── injected code blocks (fixed text) ───────────────────────────────────────

const INIT_BLOCK = `/* dsh-no-workspace: workspace-picker menu contribution registry */
${PICKER_REGISTRY} = ${PICKER_REGISTRY} || [];
`

const MERGE_BLOCK = `for (const __dshMake of ${PICKER_REGISTRY} || []) items.push(__dshMake());
`

const DISPATCH_BLOCK = `const __dshExtra = (${PICKER_REGISTRY} || []).map((make) => make()).find((entry) => entry.id === id);
if (__dshExtra !== undefined) { __dshExtra.onPick(); onClose(); return; }
`

// ── anchors in the official (unminified) bundle ─────────────────────────────

const ADD_WORKSPACE_ANCHOR = 'const ADD_WORKSPACE = "::add-workspace";'
const MENU_IS_EMPTY_ANCHOR = 'const menuIsEmpty = items.length === 0;'
// The dispatch hook must land INSIDE handleSelect's body: it reads the `id`
// parameter and calls `onClose`, both in the handler's scope. The first body
// statement of the official handler is this branch.
const HANDLE_SELECT_BODY_ANCHOR = 'if (id === ADD_WORKSPACE) {'

/** Every anchor the injection depends on, in application order. */
export const PICKER_ANCHORS: readonly string[] = [
  ADD_WORKSPACE_ANCHOR,
  MENU_IS_EMPTY_ANCHOR,
  HANDLE_SELECT_BODY_ANCHOR,
]

/**
 * Which anchors a bundle text lacks. The menu entry silently degrades when
 * the official bundle changes shape; naming the missing anchors turns that
 * silent degradation into an observable, diagnosable log line.
 * @param source - the official bundle text.
 * @returns the anchors absent from the text.
 */
export function missingPickerAnchors(source: string): string[] {
  return PICKER_ANCHORS.filter(anchor => !source.includes(anchor))
}

/** Insert `block` immediately before `anchor` in `source`; undefined when the anchor is absent. */
function insertBefore(source: string, anchor: string, block: string): string | undefined {
  const index = source.indexOf(anchor)
  if (index < 0) return undefined
  return source.slice(0, index) + block + source.slice(index)
}

/**
 * Decorate one official bundle text with the picker registry mechanism.
 * @param source - the official bundle text.
 * @returns the decorated text, or the untouched text when already decorated or
 * when any anchor is missing (fail-closed: the official bundle changed shape).
 */
export function injectPickerRegistry(source: string): string {
  if (source.includes(PICKER_REGISTRY)) return source
  let next = insertBefore(source, ADD_WORKSPACE_ANCHOR, INIT_BLOCK)
  if (next === undefined) return source
  next = insertBefore(next, MENU_IS_EMPTY_ANCHOR, MERGE_BLOCK)
  if (next === undefined) return source
  next = insertBefore(next, HANDLE_SELECT_BODY_ANCHOR, DISPATCH_BLOCK)
  return next ?? source
}

/** Whether a bundle text carries the registry decoration. */
export function isPickerInjected(source: string): boolean {
  return source.includes(PICKER_REGISTRY)
}

/**
 * Register the exact bundle route serving the decorated official bundle.
 * No-op when the web surface (webServer) or the client-modules registry is
 * absent — headless deployments have no picker to decorate. Runs a startup
 * anchor probe so an official bundle that changed shape is visible in the
 * boot log immediately, instead of only when a user notices the menu entry
 * is missing.
 * @param ctx - the plugin context.
 * @returns the disposer (empty when nothing was registered).
 */
export function installPickerInjection(ctx: Context): () => void {
  const webServer = ctx.get('webServer')
  const clientModules = ctx.get('clientModules')
  if (webServer === undefined || clientModules === undefined) return () => {}

  const bundlePath = () => clientModules.clientPath(UI_WORKSPACE_PACKAGE)

  // Startup probe: one log line per boot about whether the official bundle
  // still matches every anchor. Read failures are ignored — the serve-time
  // handling covers an unreadable bundle.
  void (async () => {
    const path = bundlePath()
    if (path === undefined) return
    try {
      const body = await readFile(path, 'utf8')
      const missing = missingPickerAnchors(body)
      if (missing.length === 0) {
        ctx.logger.info(`dsh-no-workspace: picker menu injection ready (all anchors matched in ${UI_WORKSPACE_PACKAGE})`)
      } else {
        ctx.logger.warn(
          `dsh-no-workspace: picker menu anchors missing in ${UI_WORKSPACE_PACKAGE}: ${missing.join(' | ')}; `
          + 'the workspace-picker menu entry is unavailable, the visible preset and /readonly-session command still work',
        )
      }
    } catch {
      // Bundle unreadable at boot (not built yet): serve-time handling reports it.
    }
  })()

  const serve = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const path = bundlePath()
    if (path === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      const body = await readFile(path, 'utf8')
      const decorated = injectPickerRegistry(body)
      const missing = isPickerInjected(decorated) ? [] : missingPickerAnchors(body)
      if (missing.length > 0) {
        ctx.logger.warn(
          `dsh-no-workspace: serving the ${UI_WORKSPACE_PACKAGE} bundle without the picker menu entry `
          + `(missing anchors: ${missing.join(' | ')})`,
        )
      }
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
      })
      res.end(decorated)
    } catch {
      // Registered but unreadable (bundle not built yet): loud 404 beats a silent SPA-fallback HTML page.
      res.writeHead(404)
      res.end()
    }
  }

  return webServer.register({ kind: 'exact', path: BUNDLE_ROUTE, handler: serve })
}
