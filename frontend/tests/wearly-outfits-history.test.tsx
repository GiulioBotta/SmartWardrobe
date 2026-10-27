import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = { params: new URLSearchParams(), replace: vi.fn() }
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/outfits',
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => nav.params,
}))

import { OutfitsTabs } from '@/components/outfits/outfits-tabs'

function renderTabs() {
  render(<OutfitsTabs looks={<p>looks grid</p>} history={<p>history list</p>} />)
}

describe('Outfit page tabs', () => {
  beforeEach(() => {
    nav.params = new URLSearchParams()
    nav.replace.mockReset()
  })

  it('opens on the looks', () => {
    renderTabs()
    expect(screen.getByText('looks grid')).toBeInTheDocument()
    expect(screen.queryByText('history list')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'looks' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the history when the address asks for it', () => {
    nav.params = new URLSearchParams('tab=history')
    renderTabs()
    expect(screen.getByText('history list')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'history' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switching keeps the address in step, dropping the looks-only parameters', () => {
    nav.params = new URLSearchParams('filter=worn&view=calendar')
    renderTabs()
    fireEvent.click(screen.getByRole('tab', { name: 'history' }))
    expect(nav.replace).toHaveBeenCalledWith('/dashboard/outfits?tab=history')
  })
})
