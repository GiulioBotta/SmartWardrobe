import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@/lib/types'
import type { Section } from '@/lib/wardrobe-sections'

const create = vi.fn()
const collectionItems = vi.fn()
let sections: Section[] = []
let allItems: Item[] = []

vi.mock('@/lib/hooks/use-wardrobe-sections', () => ({
  useWardrobeSections: () => ({ data: sections }),
  useAllItems: () => ({ items: allItems, isLoading: false }),
  useCreateCollection: () => ({ mutateAsync: create, isPending: false }),
  useCollectionItems: () => ({ mutateAsync: collectionItems, isPending: false }),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }))

import { NewCollectionDialog } from '@/components/wardrobe/new-collection-dialog'
import { CollectionActions } from '@/components/wardrobe/collection-actions'
import { ItemCollectionsRow } from '@/components/wardrobe/item-collections-row'

const item = (id: string) => ({ id, type: 'sweater', name: id, thumbnail_url: null }) as unknown as Item

function collection(id: string, name: string, itemIds: string[]): Section {
  return { id, kind: 'collection', key: null, name, position: 0, enabled: true, item_ids: itemIds }
}

async function openMenu(name: RegExp) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' })
  await screen.findByRole('menu')
}

beforeEach(() => {
  vi.clearAllMocks()
  allItems = [item('a'), item('b'), item('c')]
  sections = [collection('c1', 'Festa', ['a']), collection('c2', 'Ufficio', [])]
})

describe('NewCollectionDialog', () => {
  it('starts with the selected items ticked, counted once', () => {
    render(<NewCollectionDialog open onOpenChange={vi.fn()} initialItemIds={['a', 'b', 'a']} />)
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'collection.create' })).toBeDisabled()
  })

  it('creates the collection with the name and the ticked items', async () => {
    const onOpenChange = vi.fn()
    create.mockResolvedValueOnce({ id: 'new' })
    render(<NewCollectionDialog open onOpenChange={onOpenChange} initialItemIds={['a']} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Festa estiva' } })
    fireEvent.click(screen.getAllByRole('checkbox')[2])
    fireEvent.click(screen.getByRole('button', { name: 'collection.create' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Festa estiva', itemIds: ['a', 'c'] }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps picked items whose page has not loaded yet', async () => {
    create.mockResolvedValueOnce({ id: 'new' })
    render(<NewCollectionDialog open onOpenChange={vi.fn()} initialItemIds={['z', 'a']} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Festa' } })
    fireEvent.click(screen.getByRole('button', { name: 'collection.create' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'Festa', itemIds: ['a', 'z'] }),
    )
  })

  it('keeps the dialog open and warns when the name is refused', async () => {
    const onOpenChange = vi.fn()
    create.mockRejectedValueOnce(new Error('A collection with this name already exists.'))
    render(<NewCollectionDialog open onOpenChange={onOpenChange} initialItemIds={[]} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Festa' } })
    fireEvent.click(screen.getByRole('button', { name: 'collection.create' }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe('CollectionActions', () => {
  it('opens a new collection with the selection', () => {
    const onNew = vi.fn()
    render(<CollectionActions selectedIds={['a', 'b']} onNewCollection={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: 'collection.new' }))
    expect(onNew).toHaveBeenCalledWith(['a', 'b'])
  })

  it('adds the selection to a chosen collection', async () => {
    render(<CollectionActions selectedIds={['b']} onNewCollection={vi.fn()} />)
    await openMenu(/collection.addTo/)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ufficio' }))
    await waitFor(() =>
      expect(collectionItems).toHaveBeenCalledWith({ id: 'c2', itemIds: ['b'] }),
    )
  })

  it('removes the selection from a chosen collection', async () => {
    render(<CollectionActions selectedIds={['a']} onNewCollection={vi.fn()} />)
    await openMenu(/collection.removeFrom/)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Festa' }))
    await waitFor(() =>
      expect(collectionItems).toHaveBeenCalledWith({ id: 'c1', itemIds: ['a'], remove: true }),
    )
  })
})

describe('ItemCollectionsRow', () => {
  it('lists the collections of the item and removes it from one', async () => {
    render(<ItemCollectionsRow itemId="a" />)
    expect(screen.getByText('Festa')).toBeInTheDocument()
    expect(screen.queryByText('Ufficio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'collection.removeItem' }))
    await waitFor(() =>
      expect(collectionItems).toHaveBeenCalledWith({ id: 'c1', itemIds: ['a'], remove: true }),
    )
  })

  it('offers only the collections the item is not in', async () => {
    render(<ItemCollectionsRow itemId="a" />)
    await openMenu(/collection.addItem/)
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Ufficio'])
  })
})
