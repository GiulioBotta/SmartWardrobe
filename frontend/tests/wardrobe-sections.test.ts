import { describe, expect, it } from 'vitest'
import { collectionSelectionIds, groupItems, sectionErrorKey, type Section } from '@/lib/wardrobe-sections'
import type { Item } from '@/lib/types'

function item(id: string, type: string): Item {
  return { id, type } as Item
}

function category(key: string, position: number, enabled = true): Section {
  return { id: `s-${key}`, kind: 'category', key, name: null, position, enabled, item_ids: [] }
}

const DEFAULTS: Section[] = [
  category('tops', 0),
  category('knitwear', 1),
  category('outerwear', 2),
  category('trousers', 3),
  category('footwear', 4),
  category('accessories', 5),
  category('skirts', 6, false),
  category('dresses', 7, false),
  category('suits', 8, false),
  category('bags', 9, false),
  category('hosiery', 10, false),
]

const ids = (groups: ReturnType<typeof groupItems>) =>
  groups.map((g) => [g.id, g.items.map((i) => i.id)])

describe('groupItems', () => {
  it('follows the sections order and puts sweaters and hoodies in knitwear', () => {
    const groups = groupItems(
      [item('p', 'pants'), item('h', 'hoodie'), item('s', 'sweater'), item('t', 'polo')],
      DEFAULTS,
    )
    expect(ids(groups)).toEqual([
      ['s-tops', ['t']],
      ['s-knitwear', ['h', 's']],
      ['s-trousers', ['p']],
    ])
  })

  it('uses the order the sections were moved to', () => {
    const moved = DEFAULTS.map((s) => (s.key === 'trousers' ? { ...s, position: -1 } : s))
    const groups = groupItems([item('t', 'polo'), item('p', 'jeans')], moved)
    expect(groups.map((g) => g.key)).toEqual(['trousers', 'tops'])
  })

  it('sends a skirt to trousers until skirts is switched on', () => {
    expect(groupItems([item('k', 'skirt')], DEFAULTS)[0].key).toBe('trousers')
    const on = DEFAULTS.map((s) => (s.key === 'skirts' ? { ...s, enabled: true } : s))
    expect(groupItems([item('k', 'skirt')], on)[0].key).toBe('skirts')
  })

  it('puts unknown types and switched-off dresses in a last unsorted group', () => {
    const groups = groupItems(
      [item('u', 'unknown'), item('d', 'dress'), item('t', 'polo')],
      DEFAULTS,
    )
    expect(ids(groups)).toEqual([
      ['s-tops', ['t']],
      ['unsorted', ['u', 'd']],
    ])
    expect(groups[1].kind).toBe('unsorted')
  })

  it('shows an item of a collection twice, as the same object', () => {
    const party: Section = {
      id: 'c1', kind: 'collection', key: null, name: 'Festa', position: -1, enabled: true,
      item_ids: ['s'],
    }
    const sweater = item('s', 'sweater')
    const groups = groupItems([sweater], [...DEFAULTS, party])
    expect(groups.map((g) => g.id)).toEqual(['c1', 's-knitwear'])
    expect(groups[0].items[0]).toBe(groups[1].items[0])
    expect(groups[0].name).toBe('Festa')
  })

  it('leaves out empty groups and returns nothing for no items', () => {
    expect(groupItems([], DEFAULTS)).toEqual([])
    const emptyCollection: Section = {
      id: 'c2', kind: 'collection', key: null, name: 'Vuota', position: 0, enabled: true,
      item_ids: ['missing'],
    }
    expect(groupItems([item('t', 'polo')], [...DEFAULTS, emptyCollection]).map((g) => g.id))
      .toEqual(['s-tops'])
  })

  it('keeps the incoming item order inside each group', () => {
    const groups = groupItems(
      [item('b', 'sweater'), item('a', 'hoodie'), item('c', 'cardigan')],
      DEFAULTS,
    )
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('sectionErrorKey', () => {
  it('maps a known server code to its translation key', async () => {
    const { ApiError } = await import('@/lib/api')
    const error = new ApiError('A collection with this name already exists.', 422, {
      detail: { code: 'name_taken', message: 'A collection with this name already exists.' },
    })
    expect(sectionErrorKey(error)).toBe('errors.name_taken')
  })

  it('falls back for anything else', () => {
    expect(sectionErrorKey(new Error('boom'))).toBeNull()
  })
})

describe('collectionSelectionIds', () => {
  const items = [item('a', 'polo'), item('b', 'polo'), item('c', 'polo')]
  const some = { mode: 'some' as const, selectedIds: new Set(['b']), excludedIds: new Set<string>() }
  const all = { mode: 'all' as const, selectedIds: new Set<string>(), excludedIds: new Set(['b']) }

  it('uses the picked ids', () => {
    expect(collectionSelectionIds(some, items, false)).toEqual(['b'])
  })

  it('takes every loaded item minus exclusions in the grouped view', () => {
    expect(collectionSelectionIds(all, items, true)).toEqual(['a', 'c'])
  })

  it('refuses "all matching" in the paged grid, where only one page is loaded', () => {
    expect(collectionSelectionIds(all, items, false)).toBeNull()
  })
})
