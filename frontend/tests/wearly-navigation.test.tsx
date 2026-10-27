import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { batch: true, pathname: '/dashboard' }

vi.mock('@/lib/hooks/use-batch-inbox', () => ({
  useBatchUploadEnabled: () => state.batch,
}))
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { MobileNav } from '@/components/mobile-nav'
import { isActive, useNavigation } from '@/lib/navigation'

function keys() {
  let result: ReturnType<typeof useNavigation> | null = null
  function Probe() {
    result = useNavigation()
    return null
  }
  render(<Probe />)
  return { primary: result!.primary.map((e) => e.key), more: result!.more.map((e) => e.key) }
}

describe('Wearly navigation', () => {
  beforeEach(() => {
    state.batch = true
    state.pathname = '/dashboard'
  })

  it('has Oggi, Armadio, Outfit and the "Altro" group', () => {
    expect(keys()).toEqual({ primary: ['today', 'wardrobe', 'outfits'], more: ['inbox', 'analytics', 'settings'] })
  })

  it('leaves "Da rivedere" out while batch upload is off', () => {
    state.batch = false
    expect(keys().more).toEqual(['analytics', 'settings'])
  })

  it('marks the right entry as current', () => {
    expect(isActive('/dashboard', '/dashboard')).toBe(true)
    expect(isActive('/dashboard', '/dashboard/wardrobe')).toBe(false)
    expect(isActive('/dashboard/outfits', '/dashboard/outfits/abc')).toBe(true)
    expect(isActive('/dashboard/outfits', '/dashboard/outfitsx')).toBe(false)
  })

  it('shows four entries on the phone and lights up "Altro" on its pages', () => {
    state.pathname = '/dashboard/settings'
    render(<MobileNav />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/dashboard',
      '/dashboard/wardrobe',
      '/dashboard/outfits',
      '/dashboard/more',
    ])
    expect(links[3]).toHaveAttribute('aria-current', 'page')
    // The moka accent is too light for small text on cream (3.6-4:1); the label stays coffee.
    expect(links[3].className).toContain('text-foreground')
    expect(links[3].className).not.toContain('text-brand')
    expect(links[0]).not.toHaveAttribute('aria-current')
  })
})
