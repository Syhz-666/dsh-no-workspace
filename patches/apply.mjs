#!/usr/bin/env node
/**
 * dsh-no-workspace: workspace-picker menu contribution patch.
 *
 * Applies a minimal, generic mechanism to the OFFICIAL
 * `@deepseek-ai/dsh-client-ui-workspace` client bundle (its built
 * lib/client.js): a window-level "extra menu items" registry the picker menu
 * merges into its items, plus dispatch handling for those ids. The official
 * default behavior is unchanged when no plugin registers an entry; the patch
 * is invertible (revert) and idempotent (apply twice is a no-op).
 *
 * This is a distribution-layer patch: it touches only build artifacts of the
 * installed official package, never its source, and never this plugin's own
 * code. Re-run `apply` after upgrading the official package.
 *
 * Usage:
 *   node patches/apply.mjs apply [path-to-lib-client.js]
 *   node patches/apply.mjs verify [path]
 *   node patches/apply.mjs revert [path]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MARKER = 'window.__DSH_WORKSPACE_PICKER_EXTRA_ITEMS__'

// ── injected code blocks (fixed text; revert replaces them back) ────────────

const INIT_BLOCK = `/* dsh-no-workspace patch: workspace-picker menu contribution registry */
${MARKER} = ${MARKER} || [];
`

const MERGE_BLOCK = `for (const __dshMake of ${MARKER} || []) items.push(__dshMake());
`

const DISPATCH_BLOCK = `const __dshExtra = (${MARKER} || []).map((make) => make()).find((entry) => entry.id === id);
if (__dshExtra !== undefined) { __dshExtra.onPick(); onClose(); return; }
`

// ── anchors in the official (unminified) bundle ─────────────────────────────

const ADD_WORKSPACE_ANCHOR = 'const ADD_WORKSPACE = "::add-workspace";'
const MENU_IS_EMPTY_ANCHOR = 'const menuIsEmpty = items.length === 0;'
const HANDLE_SELECT_ANCHOR = 'const handleSelect = (id) => {'

// ── target discovery ────────────────────────────────────────────────────────

/** Candidate bundle paths: explicit arg, env, source checkout, then profile installs. */
function candidates(explicit) {
  const list = []
  if (explicit !== undefined) list.push(explicit)
  if (process.env.DSH_NO_WORKSPACE_UI_BUNDLE !== undefined) list.push(process.env.DSH_NO_WORKSPACE_UI_BUNDLE)
  list.push('packages/client/ui-workspace/lib/client.js')
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  list.push(join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js'))
  return list
}

/** Resolve the first existing candidate, or undefined. */
function resolveTarget(explicit) {
  for (const candidate of candidates(explicit)) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

// ── patch operations ────────────────────────────────────────────────────────

/** Insert `block` immediately before `anchor` in `source`; throws when the anchor is absent. */
function insertBefore(source, anchor, block, label) {
  const index = source.indexOf(anchor)
  if (index < 0) throw new Error(`anchor not found: ${label}`)
  return source.slice(0, index) + block + source.slice(index)
}

/** Remove the exact `block` from `source`; throws when absent (or present twice). */
function removeBlock(source, block, label) {
  const first = source.indexOf(block)
  if (first < 0) throw new Error(`injected block not found: ${label}`)
  const second = source.indexOf(block, first + 1)
  if (second >= 0) throw new Error(`injected block present twice: ${label}`)
  return source.slice(0, first) + source.slice(first + block.length)
}

function applyOnce(source) {
  if (source.includes(MARKER)) return { source, applied: false }
  let next = insertBefore(source, ADD_WORKSPACE_ANCHOR, INIT_BLOCK, 'ADD_WORKSPACE constant')
  next = insertBefore(next, MENU_IS_EMPTY_ANCHOR, MERGE_BLOCK, 'menuIsEmpty')
  next = insertBefore(next, HANDLE_SELECT_ANCHOR, DISPATCH_BLOCK, 'handleSelect')
  return { source: next, applied: true }
}

function revertOnce(source) {
  if (!source.includes(MARKER)) return { source, reverted: false }
  let next = removeBlock(source, DISPATCH_BLOCK, 'dispatch block')
  next = removeBlock(next, MERGE_BLOCK, 'merge block')
  next = removeBlock(next, INIT_BLOCK, 'init block')
  return { source: next, reverted: true }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const command = process.argv[2]
const explicit = process.argv[3]
const target = resolveTarget(explicit)

if (target === undefined) {
  process.stderr.write(
    'dsh-no-workspace patch: no ui-workspace client bundle found.\n'
    + `Searched: ${candidates(explicit).join('\n          ')}\n`
    + 'Build the official package first, or pass the bundle path explicitly.\n',
  )
  process.exit(2)
}

try {
  const original = await readFile(target, 'utf8')
  if (command === 'apply') {
    const { source, applied } = applyOnce(original)
    if (applied) await writeFile(target, source)
    console.log(`dsh-no-workspace patch: ${applied ? 'applied' : 'already applied'} -> ${target}`)
  } else if (command === 'revert') {
    const { source, reverted } = revertOnce(original)
    if (reverted) await writeFile(target, source)
    console.log(`dsh-no-workspace patch: ${reverted ? 'reverted' : 'not applied'} -> ${target}`)
  } else if (command === 'verify') {
    const applied = original.includes(MARKER)
    console.log(`dsh-no-workspace patch: ${applied ? 'applied' : 'NOT applied'} -> ${target}`)
    process.exit(applied ? 0 : 1)
  } else {
    process.stderr.write('usage: node patches/apply.mjs <apply|verify|revert> [path]\n')
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`dsh-no-workspace patch: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
