import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ItemTagSelects } from '@/components/wardrobe/item-tag-selects'
import { editableTagsFrom, tagChanges } from '@/lib/garment-tags'

describe('editableTagsFrom', () => {
  it('reads the three tags and blanks the missing ones', () => {
    expect(editableTagsFrom({ material: 'wool', colors: [], style: [], season: [] })).toEqual({
      pattern: '',
      material: 'wool',
      formality: '',
    })
    expect(editableTagsFrom(null)).toEqual({ pattern: '', material: '', formality: '' })
  })
})

describe('tagChanges', () => {
  const before = { pattern: 'solid', material: 'wool', formality: 'casual' }

  it('is undefined when nothing changed', () => {
    expect(tagChanges(before, { ...before })).toBeUndefined()
  })

  it('sends only the changed fields', () => {
    expect(tagChanges(before, { ...before, material: 'cotton' })).toEqual({ material: 'cotton' })
  })

  it('clears an emptied field with null', () => {
    expect(tagChanges(before, { ...before, formality: '' })).toEqual({ formality: null })
  })

  it('sets a field the item did not have', () => {
    expect(tagChanges({}, { pattern: '', material: 'linen', formality: '' })).toEqual({
      material: 'linen',
    })
  })
})

describe('ItemTagSelects', () => {
  it('shows a select for material, pattern and formality', () => {
    render(
      <ItemTagSelects
        value={{ pattern: 'solid', material: 'wool', formality: 'casual' }}
        onChange={vi.fn()}
      />,
    )
    for (const field of ['material', 'pattern', 'formality']) {
      expect(screen.getByRole('combobox', { name: field })).toBeInTheDocument()
    }
  })
})
