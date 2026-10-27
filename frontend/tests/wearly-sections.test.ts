import { describe, expect, it } from 'vitest'
import { legacyRedirect } from '@/lib/legacy-routes'
import { HIDDEN_SECTIONS, isSectionVisible, type Section } from '@/lib/sections'

describe('hidden sections', () => {
  it('hides what Wearly does not show', () => {
    for (const section of ['family', 'learning', 'pairings', 'aiEndpoints', 'bodyMeasurements'] as Section[]) {
      expect(isSectionVisible(section)).toBe(false)
    }
  })
})

describe('legacyRedirect', () => {
  it('sends moved pages to their new place', () => {
    expect(legacyRedirect('/dashboard/history')).toBe('/dashboard/outfits?tab=history')
    expect(legacyRedirect('/dashboard/notifications')).toBe('/dashboard/settings#notifications')
    expect(legacyRedirect('/dashboard/today')).toBe('/dashboard')
  })

  it('sends hidden pages home while they are hidden', () => {
    for (const path of ['/dashboard/family', '/dashboard/family/feed', '/dashboard/learning', '/dashboard/pairings']) {
      expect(legacyRedirect(path)).toBe('/dashboard')
    }
    const pairingsBack = new Set<Section>(Array.from(HIDDEN_SECTIONS).filter((s) => s !== 'pairings'))
    expect(legacyRedirect('/dashboard/pairings', pairingsBack)).toBeNull()
    expect(legacyRedirect('/dashboard/family', pairingsBack)).toBe('/dashboard')
  })

  it('leaves every other page alone', () => {
    for (const path of ['/dashboard', '/dashboard/wardrobe', '/dashboard/outfits', '/dashboard/outfits/abc', '/dashboard/inbox', '/login']) {
      expect(legacyRedirect(path)).toBeNull()
    }
  })

  it('ignores a trailing slash', () => {
    expect(legacyRedirect('/dashboard/history/')).toBe('/dashboard/outfits?tab=history')
  })
})
