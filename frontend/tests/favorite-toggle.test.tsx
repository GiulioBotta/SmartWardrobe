import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mutate = vi.fn()
vi.mock('@/lib/hooks/use-items', () => ({
  useUpdateItem: () => ({ mutate, isPending: false }),
}))

import { FavoriteToggle } from '@/components/wardrobe/favorite-toggle'

describe('FavoriteToggle', () => {
  it('flips the favourite without opening the card', () => {
    const openCard = vi.fn()
    render(
      <div onClick={openCard}>
        <FavoriteToggle item={{ id: 'i1', favorite: false }} />
      </div>,
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(mutate).toHaveBeenCalledWith({ id: 'i1', data: { favorite: true } })
    expect(openCard).not.toHaveBeenCalled()
  })

  it('unsets a favourite', () => {
    mutate.mockClear()
    render(<FavoriteToggle item={{ id: 'i2', favorite: true }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(mutate).toHaveBeenCalledWith({ id: 'i2', data: { favorite: false } })
  })
})
