import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '@/components/brand/page-header'

describe('PageHeader', () => {
  it('sets the page title in the magazine serif, with subtitle and actions', () => {
    render(<PageHeader title="Il mio armadio" subtitle="18 capi" actions={<button>Aggiungi</button>} />)
    const title = screen.getByRole('heading', { level: 1, name: 'Il mio armadio' })
    expect(title.className).toContain('font-serif')
    expect(screen.getByText('18 capi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeInTheDocument()
  })

  it('works without subtitle or actions', () => {
    render(<PageHeader title="Analisi" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Analisi' })).toBeInTheDocument()
  })
})
