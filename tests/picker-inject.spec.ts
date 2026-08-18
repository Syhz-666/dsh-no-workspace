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
    '  if (id === ADD_WORKSPACE) return openWorkspaceDialog();',
    '};',
  ].join('\n')
}

describe('injectPickerRegistry', () => {
  it('injects the registry init, the item merge, and the dispatch hook', () => {
    const decorated = injectPickerRegistry(officialLike())
    expect(decorated).toContain(`${PICKER_REGISTRY} = ${PICKER_REGISTRY} || [];`)
    expect(decorated).toContain('for (const __dshMake of')
    expect(decorated).toContain('__dshExtra.onPick(); onClose(); return;')
    expect(decorated.indexOf('__dshExtra')).toBeGreaterThan(decorated.indexOf('const ADD_WORKSPACE'))
    expect(decorated.indexOf('for (const __dshMake')).toBeGreaterThan(decorated.indexOf('const ADD_WORKSPACE'))
    expect(isPickerInjected(decorated)).toBe(true)
  })

  it('is idempotent: an already decorated bundle is returned untouched', () => {
    const once = injectPickerRegistry(officialLike())
    const twice = injectPickerRegistry(once)
    expect(twice).toBe(once)
  })

  it('fails closed when any anchor is missing (official bundle changed shape)', () => {
    const missingMenu = officialLike().replace('const menuIsEmpty = items.length === 0;', 'const count = items.length;')
    expect(injectPickerRegistry(missingMenu)).toBe(missingMenu)
    const missingSelect = officialLike().replace('const handleSelect = (id) => {', 'const pick = (id) => {')
    expect(injectPickerRegistry(missingSelect)).toBe(missingSelect)
    expect(isPickerInjected(injectPickerRegistry(missingMenu))).toBe(false)
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
