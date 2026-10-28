import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Section } from '@/lib/wardrobe-sections'

const reorder = vi.fn()
const update = vi.fn()
const reset = vi.fn()
const remove = vi.fn()
let sections: Section[] = []
let counts: Record<string, number> = {}
let reordering = false

vi.mock('@/lib/hooks/use-wardrobe-sections', () => ({
  useWardrobeSections: () => ({ data: sections }),
  useHiddenCounts: () => ({ data: counts }),
  useReorderSections: () => ({ mutate: reorder, isPending: reordering }),
  useUpdateSection: () => ({ mutateAsync: update, isPending: false }),
  useResetSectionOrder: () => ({ mutate: reset, isPending: false }),
  useDeleteCollection: () => ({ mutateAsync: remove, isPending: false }),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }))

import { OrganizeSectionsDialog } from '@/components/wardrobe/organize-sections-dialog'

function cat(key: string, position: number, enabled = true): Section {
  return { id: `s-${key}`, kind: 'category', key, name: null, position, enabled, item_ids: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  sections = [
    cat('tops', 0),
    cat('knitwear', 1),
    { id: 'c1', kind: 'collection', key: null, name: 'Festa', position: 2, enabled: true, item_ids: [] },
    cat('skirts', 3, false),
  ]
  counts = { skirts: 2, dresses: 0 }
  reordering = false
})

function open() {
  return render(<OrganizeSectionsDialog open onOpenChange={vi.fn()} onNewCollection={vi.fn()} />)
}

describe('OrganizeSectionsDialog', () => {
  it('lists visible groups in order and moves one down with the arrow', () => {
    open()
    const rows = screen.getAllByTestId('section-row').map((r) => r.textContent)
    expect(rows[0]).toContain('names.tops')
    expect(rows[2]).toContain('Festa')
    fireEvent.click(screen.getAllByRole('button', { name: 'organize.moveDown' })[0])
    expect(reorder).toHaveBeenCalledWith(['s-knitwear', 's-tops', 'c1', 's-skirts'], expect.anything())
  })

  it('cannot move the first up or the last down', () => {
    open()
    const ups = screen.getAllByRole('button', { name: 'organize.moveUp' })
    const downs = screen.getAllByRole('button', { name: 'organize.moveDown' })
    expect(ups[0]).toBeDisabled()
    expect(downs[downs.length - 1]).toBeDisabled()
  })

  it('switches an optional category on and shows how many items it would hold', () => {
    open()
    expect(screen.getByTestId('would-hold-skirts')).toBeInTheDocument()
    expect(screen.queryByTestId('would-hold-dresses')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'names.skirts' }))
    expect(update).toHaveBeenCalledWith({ id: 's-skirts', data: { enabled: true } })
  })

  it('restores the name and warns when a rename is refused', async () => {
    update.mockRejectedValueOnce(new Error('A collection with this name already exists.'))
    open()
    fireEvent.click(screen.getByRole('button', { name: 'organize.rename' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Tops' } })
    fireEvent.submit(input)
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getAllByTestId('section-row')[2].textContent).toContain('Festa')
  })

  it('holds the arrows while a move is being saved', () => {
    reordering = true
    open()
    for (const name of ['organize.moveUp', 'organize.moveDown']) {
      for (const button of screen.getAllByRole('button', { name })) expect(button).toBeDisabled()
    }
  })

  it('resets the order', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /organize.reset/ }))
    expect(reset).toHaveBeenCalled()
  })
})
