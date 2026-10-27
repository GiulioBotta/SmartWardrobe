import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LogoMark } from '@/components/brand/logo-mark'
import { APP_NAME } from '@/lib/brand'

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter' }),
  Gelasio: () => ({ variable: 'gelasio' }),
}))

describe('Wearly brand', () => {
  it('has its (temporary) name in one place', () => {
    expect(APP_NAME).toBe('Wearly')
  })

  it('draws the drawer logo on the espresso square', () => {
    const { container } = render(<LogoMark size={32} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const drawer = svg.querySelectorAll('rect')
    const body = Array.from(drawer).find((r) => r.getAttribute('width') === '26')!
    expect([body.getAttribute('x'), body.getAttribute('y'), body.getAttribute('height'), body.getAttribute('rx')]).toEqual([
      '7', '9', '22', '3',
    ])
    expect(svg.querySelectorAll('path')).toHaveLength(3)
  })

  it('names the browser tab after the app', async () => {
    const { metadata } = await import('@/app/layout')
    expect(metadata.title).toBe(APP_NAME)
  })
})
