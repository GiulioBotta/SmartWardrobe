import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemPickerGrid } from '@/components/today/item-picker-grid'
import {
  daysAgo,
  groupBySlot,
  logWornToday,
  outfitsToRepeat,
  slotOf,
  wearSuggestionToday,
  wornToday,
} from '@/lib/quick-log'
import type { Item, Outfit } from '@/lib/types'

function item(id: string, type: string, extra: Partial<Item> = {}): Item {
  return { id, type, status: 'ready', is_archived: false, wear_count: 0, ...extra } as Item
}

function outfit(id: string, itemIds: string[], wornAt: string | null, extra: Partial<Outfit> = {}): Outfit {
  return {
    id,
    occasion: 'casual',
    name: null,
    items: itemIds.map((i) => ({ id: i, type: 'shirt' })),
    feedback: wornAt ? { worn_at: wornAt, actually_worn: null } : null,
    ...extra,
  } as unknown as Outfit
}

describe('slots', () => {
  it('puts each type in the slot of its role', () => {
    expect(slotOf('t-shirt')).toBe('tops')
    expect(slotOf('sweater')).toBe('tops')
    expect(slotOf('jeans')).toBe('bottoms')
    expect(slotOf('coat')).toBe('outerwear')
    expect(slotOf('sneakers')).toBe('shoes')
    expect(slotOf('belt')).toBe('accessories')
    expect(slotOf('something-new')).toBe('accessories')
  })

  it('groups ready items, most recently worn first', () => {
    const groups = groupBySlot([
      item('old', 'shirt', { last_worn_at: '2026-10-01' }),
      item('new', 'shirt', { last_worn_at: '2026-10-20' }),
      item('never', 'shirt', { wear_count: 0 }),
      item('busy', 'polo', { wear_count: 9 }),
      item('jeans', 'jeans'),
      item('gone', 'shirt', { is_archived: true }),
      item('wip', 'shirt', { status: 'processing' }),
    ])
    expect(groups.tops.map((i) => i.id)).toEqual(['new', 'old', 'busy', 'never'])
    expect(groups.bottoms.map((i) => i.id)).toEqual(['jeans'])
    expect(groups.shoes).toEqual([])
  })
})

describe('worn outfits', () => {
  const today = '2026-10-27'

  it('offers each past look once, newest first, and not today or unworn ones', () => {
    const outfits = [
      outfit('a', ['1', '2'], '2026-10-20'),
      outfit('b', ['2', '1'], '2026-10-25'), // same look worn again
      outfit('c', ['3'], '2026-10-22'),
      outfit('d', ['4'], today),
      outfit('e', ['5'], null),
      outfit('f', ['6'], '2026-10-24', { feedback: { worn_at: '2026-10-24', actually_worn: false } } as Partial<Outfit>),
    ]
    expect(outfitsToRepeat(outfits, today).map((o) => o.id)).toEqual(['b', 'c'])
    expect(wornToday(outfits, today).map((o) => o.id)).toEqual(['d'])
  })

  it('counts days back across month ends', () => {
    expect(daysAgo('2026-11-03', 14)).toBe('2026-10-20')
  })
})

describe('logging calls', () => {
  beforeEach(() => vi.mocked(global.fetch).mockReset())

  const ok = () => Promise.resolve(new Response('{}', { status: 200 }))

  it('accepts a suggestion and records it as worn', async () => {
    vi.mocked(global.fetch).mockImplementation(ok)
    await wearSuggestionToday('o1')
    const calls = vi.mocked(global.fetch).mock.calls
    expect(calls.map((c) => c[0])).toEqual(['/api/v1/outfits/o1/accept', '/api/v1/outfits/o1/feedback'])
    expect(JSON.parse(calls[1][1]!.body as string)).toEqual({ accepted: true, worn: true, actually_worn: true })
  })

  it('logs picked pieces through the Studio as worn today', async () => {
    vi.mocked(global.fetch).mockImplementation(ok)
    await logWornToday(['i1', 'i2'], 'office', '2026-10-27')
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('/api/v1/outfits/studio')
    expect(JSON.parse(init!.body as string)).toEqual({
      items: ['i1', 'i2'],
      occasion: 'office',
      scheduled_for: '2026-10-27',
      mark_worn: true,
    })
  })
})

describe('ItemPickerGrid', () => {
  it('shows only slots with items and toggles a piece', () => {
    const onToggle = vi.fn()
    const groups = groupBySlot([item('s', 'shirt', { name: 'Oxford' }), item('j', 'jeans')])
    render(<ItemPickerGrid groups={groups} selected={new Set(['j'])} onToggle={onToggle} />)
    expect(screen.getByText('slots.tops')).toBeInTheDocument()
    expect(screen.queryByText('slots.shoes')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Oxford' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Oxford' }))
    expect(onToggle).toHaveBeenCalledWith('s')
    const pressed = screen.getAllByTestId('today-item').filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
  })
})
