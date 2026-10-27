import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OutfitFilterPanel } from '@/components/suggest/outfit-filter-panel'
import {
  EMPTY_FILTERS,
  countActiveFilters,
  cycleColor,
  toRequestFilters,
  type OutfitFilters,
} from '@/lib/suggest-filters'

describe('suggestion filter helpers', () => {
  it('cycles a colour through keep, avoid and back to none', () => {
    const kept = cycleColor(EMPTY_FILTERS, 'red')
    expect(kept.colors).toEqual(['red'])
    const avoided = cycleColor(kept, 'red')
    expect(avoided.colors).toEqual([])
    expect(avoided.exclude_colors).toEqual(['red'])
    expect(cycleColor(avoided, 'red')).toEqual(EMPTY_FILTERS)
  })

  it('sends nothing for an untouched panel and only the narrowing fields otherwise', () => {
    expect(toRequestFilters(EMPTY_FILTERS)).toBeUndefined()
    const filters: OutfitFilters = { ...EMPTY_FILTERS, exclude_types: ['shorts'], not_worn_in_days: 7 }
    expect(toRequestFilters(filters)).toEqual({ exclude_types: ['shorts'], not_worn_in_days: 7 })
    expect(countActiveFilters(filters)).toBe(2)
  })
})

describe('OutfitFilterPanel', () => {
  function renderPanel(filters: OutfitFilters = EMPTY_FILTERS) {
    const onChange = vi.fn()
    render(<OutfitFilterPanel filters={filters} onChange={onChange} hasPinned={false} />)
    fireEvent.click(screen.getByTestId('filters-toggle'))
    return onChange
  }

  it('keeps a colour on the first tap', () => {
    const onChange = renderPanel()
    fireEvent.click(screen.getByTestId('filter-color-navy'))
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, colors: ['navy'] })
  })

  it('marks an avoided colour and toggles skipped types and formality', () => {
    const onChange = renderPanel({ ...EMPTY_FILTERS, exclude_colors: ['red'] })
    expect(screen.getByTestId('filter-color-red')).toHaveAttribute('data-choice', 'avoid')
    fireEvent.click(screen.getByTestId('filter-skip-shorts'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      exclude_colors: ['red'],
      exclude_types: ['shorts'],
    })
    fireEvent.click(screen.getByTestId('filter-formality-formal'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_FILTERS,
      exclude_colors: ['red'],
      formality: ['formal'],
    })
  })

  it('shows the pinned-formality note only when items are pinned', () => {
    render(<OutfitFilterPanel filters={EMPTY_FILTERS} onChange={vi.fn()} hasPinned={true} />)
    fireEvent.click(screen.getByTestId('filters-toggle'))
    expect(screen.getByText('pinnedFormality')).toBeInTheDocument()
  })
})
