import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pageCounts: number[] = []
let pageState = { hasMore: true, isFetching: false, isError: false, loadedPages: 1 }

vi.mock('@/lib/hooks/use-items', () => ({
  useItemPages: (_filters: unknown, pageCount: number) => {
    pageCounts.push(pageCount)
    return { items: [], total: 0, isLoading: false, ...pageState }
  },
}))
vi.mock('@/lib/hooks/use-features', () => ({ useFeatures: () => ({ data: {} }) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'authenticated' }) }))

import { useAllItems } from '@/lib/hooks/use-wardrobe-sections'

beforeEach(() => {
  pageCounts.length = 0
})

describe('useAllItems', () => {
  it('asks for the next page once the last one has loaded', () => {
    pageState = { hasMore: true, isFetching: false, isError: false, loadedPages: 1 }
    renderHook(() => useAllItems({}))
    expect(Math.max(...pageCounts)).toBeGreaterThanOrEqual(2)
  })

  it('stops at a failed page instead of skipping it', () => {
    pageState = { hasMore: true, isFetching: false, isError: true, loadedPages: 1 }
    const { result } = renderHook(() => useAllItems({}))
    expect(Math.max(...pageCounts)).toBe(1)
    expect(result.current.isError).toBe(true)
  })

  it('waits while a requested page has not loaded', () => {
    pageState = { hasMore: true, isFetching: false, isError: false, loadedPages: 0 }
    renderHook(() => useAllItems({}))
    expect(Math.max(...pageCounts)).toBe(1)
  })
})
