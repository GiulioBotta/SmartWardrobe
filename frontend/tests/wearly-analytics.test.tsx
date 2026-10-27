import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/lib/hooks/use-translated-constants', () => ({
  useColorLabel: () => (c: string) => c,
  useTypeLabel: () => (t: string) => t,
  useStyleLabel: () => (s: string) => s,
  useOccasionLabel: () => (o: string) => o,
  useWeatherConditionLabel: () => (c: string) => c,
}))
vi.mock('@/lib/hooks/use-analytics', () => ({
  useAnalytics: () => ({
    isLoading: false,
    data: {
      wardrobe: {
        total_items: 4, items_by_status: { ready: 4 }, total_outfits: 2, outfits_this_week: 3,
        outfits_this_month: 5, acceptance_rate: 50, average_rating: null, total_wears: 7,
      },
      color_distribution: [], type_distribution: [], most_worn: [], least_worn: [], never_worn: [],
      acceptance_trend: [], insights: [],
    },
  }),
}))

import AnalyticsPage from '@/app/dashboard/analytics/page'

describe('Analisi', () => {
  it('opens with the weekly summary that used to be on the dashboard', () => {
    render(<AnalyticsPage />)
    expect(screen.getByText('weeklySummary.title')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })
})
