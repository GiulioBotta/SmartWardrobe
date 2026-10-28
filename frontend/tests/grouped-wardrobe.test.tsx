import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GroupedWardrobe, COLLAPSED_KEY } from '@/components/wardrobe/grouped-wardrobe'
import type { ItemGroup } from '@/lib/wardrobe-sections'
import type { Item } from '@/lib/types'

const item = (id: string) => ({ id, type: 'sweater' }) as Item

const GROUPS: ItemGroup[] = [
  { id: 'c1', kind: 'collection', key: null, name: 'Festa', items: [item('a')] },
  { id: 's-knit', kind: 'category', key: 'knitwear', name: null, items: [item('a'), item('b')] },
]

function renderGroups(groups = GROUPS) {
  return render(
    <GroupedWardrobe
      groups={groups}
      renderItem={(it, groupId) => <div data-testid={`card-${groupId}-${it.id}`}>{it.id}</div>}
    />,
  )
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('GroupedWardrobe', () => {
  it('shows each group title in order, with its cards', () => {
    renderGroups()
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings[0]).toContain('Festa')
    expect(headings[1]).toContain('names.knitwear')
    expect(screen.getByTestId('card-c1-a')).toBeInTheDocument()
    expect(screen.getByTestId('card-s-knit-a')).toBeInTheDocument()
    expect(screen.getByTestId('card-s-knit-b')).toBeInTheDocument()
  })

  it('marks collections apart from categories', () => {
    const { container } = renderGroups()
    expect(container.querySelector('[data-kind="collection"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-kind="category"]')).toHaveLength(1)
  })

  it('collapses a group from its title and remembers it', () => {
    renderGroups()
    const toggle = screen.getAllByRole('button')[1]
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('card-s-knit-b')).toBeNull()
    expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')).toEqual(['s-knit'])
    fireEvent.click(toggle)
    expect(screen.getByTestId('card-s-knit-b')).toBeInTheDocument()
  })

  it('starts with the groups closed last time', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['c1']))
    renderGroups()
    expect(screen.queryByTestId('card-c1-a')).toBeNull()
  })

  it('still collapses when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderGroups()
    const toggle = screen.getAllByRole('button')[0]
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders nothing without groups', () => {
    const { container } = renderGroups([])
    expect(container).toBeEmptyDOMElement()
  })
})
