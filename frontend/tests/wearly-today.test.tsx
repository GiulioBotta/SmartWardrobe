import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TodayBox } from '@/components/today/today-box'
import type { Outfit } from '@/lib/types'

const look = (id: string) =>
  ({ id, occasion: 'casual', name: null, items: [{ id: `${id}-i`, type: 'shirt', name: 'Polo' }] }) as unknown as Outfit

function box(props: Partial<Parameters<typeof TodayBox>[0]> = {}) {
  const handlers = { onPick: vi.fn(), onRepeat: vi.fn(), onWear: vi.fn(), onSkip: vi.fn() }
  render(<TodayBox loggedToday={[]} pending={null} busy={false} {...handlers} {...props} />)
  return handlers
}

describe('TodayBox', () => {
  it('offers a suggestion, picking by hand or repeating a look when nothing is logged', () => {
    const on = box()
    expect(screen.getByRole('link', { name: 'today.suggest' })).toHaveAttribute('href', '/dashboard/suggest')
    fireEvent.click(screen.getByRole('button', { name: 'today.pick' }))
    fireEvent.click(screen.getByRole('button', { name: 'today.repeat' }))
    expect(on.onPick).toHaveBeenCalled()
    expect(on.onRepeat).toHaveBeenCalled()
  })

  it('shows the outfit the daily notification proposed, to wear or skip', () => {
    const pending = look('p1')
    const on = box({ pending })
    fireEvent.click(screen.getByRole('button', { name: 'today.wearIt' }))
    fireEvent.click(screen.getByRole('button', { name: 'today.skip' }))
    expect(on.onWear).toHaveBeenCalledWith(pending)
    expect(on.onSkip).toHaveBeenCalledWith(pending)
    expect(screen.queryByRole('button', { name: 'today.pick' })).not.toBeInTheDocument()
  })

  it('shows what is logged today, and nothing pending, once something is logged', () => {
    box({ loggedToday: [look('l1')], pending: look('p1') })
    expect(screen.getByText('today.loggedTitle')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'today.wearIt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'today.addAnother' })).toBeInTheDocument()
  })
})
