/**
 * The in-memory picker injection: decorates the official bundle text with the
 * menu registry mechanism, fails closed when the official anchors change, and
 * is idempotent. Mirrors the exact anchor strings of the current official
 * ui-workspace bundle.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { injectPickerRegistry, isPickerInjected, PICKER_REGISTRY } from '../src/picker-inject.ts'

/** A minimal official-bundle-shaped source carrying all three anchors. */
function officialLike(): string {
  return [
    'const ADD_WORKSPACE = "::add-workspace";',
    'const items = [];',
    'const menuIsEmpty = items.length === 0;',
    'const handleSelect = (id) => {',
    '  if (id === ADD_WORKSPACE) {',
    '    openDirectoryFlow();',
    '    return;',
    '  }',
    '  onPick(id);',
    '};',
  ].join('\n')
}

describe('injectPickerRegistry', () => {
  it('injects the registry init, the item merge, and the dispatch hook', () => {
    const decorated = injectPickerRegistry(officialLike())
    expect(decorated).toContain(`${PICKER_REGISTRY} = ${PICKER_REGISTRY} || [];`)
    expect(decorated).toContain('for (const __dshMake of')
    expect(decorated).toContain('__dshExtra.onPick(); onClose(); return;')
    expect(isPickerInjected(decorated)).toBe(true)
  })

  it('lands the dispatch hook INSIDE handleSelect (id and onClose are in scope), never at module top level', () => {
    const decorated = injectPickerRegistry(officialLike())
    const handleSelectAt = decorated.indexOf('const handleSelect = (id) => {')
    const dispatchAt = decorated.indexOf('__dshExtra.onPick(); onClose(); return;')
    const bodyAnchorAt = decorated.indexOf('if (id === ADD_WORKSPACE) {')
    expect(dispatchAt).toBeGreaterThan(handleSelectAt)
    expect(dispatchAt).toBeLessThan(bodyAnchorAt)
  })

  it('is idempotent: an already decorated bundle is returned untouched', () => {
    const once = injectPickerRegistry(officialLike())
    const twice = injectPickerRegistry(once)
    expect(twice).toBe(once)
  })

  it('fails closed when any anchor is missing (official bundle changed shape)', () => {
    const missingMenu = officialLike().replace('const menuIsEmpty = items.length === 0;', 'const count = items.length;')
    expect(injectPickerRegistry(missingMenu)).toBe(missingMenu)
    const missingSelect = officialLike().replace('if (id === ADD_WORKSPACE) {', 'if (id === "::add") {')
    expect(injectPickerRegistry(missingSelect)).toBe(missingSelect)
    expect(isPickerInjected(injectPickerRegistry(missingMenu))).toBe(false)
  })

  it('pins the crash the old placement caused: with a registered entry, the dispatch code at module top level throws on the `id` reference', () => {
    // An empty registry never calls the find callback, so the module loads;
    // the moment a plugin has registered an entry (our client half does), the
    // top-level find evaluates `entry.id === id` and throws a ReferenceError
    // that kills the whole ui-workspace bundle.
    const dispatchWithEntry = 'const __dshExtra = ([() => ({ id: "::no-workspace" })]).map((make) => make()).find((entry) => entry.id === id);'
    // Inside a handler with `id` in scope it evaluates fine...
    const insideHandler = new Function('id', `${dispatchWithEntry}\nreturn __dshExtra;`)
    expect(insideHandler('::no-workspace')).toMatchObject({ id: '::no-workspace' })
    // ...but at module top level (before handleSelect's declaration) it throws.
    expect(() => new Function(dispatchWithEntry)()).toThrow(ReferenceError)
  })
})

describe('against the real official bundle', () => {
  const bundle = readFileSync(
    'D:/Deepseek-Harness/packages/client/ui-workspace/lib/client.js',
    'utf8',
  )

  it('still matches every anchor of the current official build', () => {
    const decorated = injectPickerRegistry(bundle)
    expect(isPickerInjected(decorated)).toBe(true)
  })
})
