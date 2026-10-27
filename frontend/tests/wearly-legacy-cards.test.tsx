import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hooks/use-notifications', () => ({
  useSchedules: () => ({ data: [], isLoading: false }),
  useNotificationSettings: () => ({ data: [], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-translated-constants', () => ({ useOccasionLabel: () => (o: string) => o }))
vi.mock('@/lib/hooks/use-user', () => ({ useUserTimezone: () => 'UTC' }))

import { NextScheduledCard } from '@/components/legacy/next-scheduled-card'
import { NotificationStatusCard } from '@/components/legacy/notification-status-card'

// These cards sit inside Settings › Notifiche now; their buttons must stay on that section instead
// of bouncing through the old /dashboard/notifications redirect.
describe('notification cards in Settings', () => {
  it('"add channel" stays on the Notifiche section', () => {
    render(<NotificationStatusCard />)
    expect(screen.getByRole('link', { name: 'notifications.addChannel' })).toHaveAttribute(
      'href',
      '/dashboard/settings#notifications',
    )
  })

  it('"set up a schedule" stays on the Notifiche section', () => {
    render(<NextScheduledCard />)
    expect(screen.getByRole('link', { name: 'nextScheduled.setUpSchedule' })).toHaveAttribute(
      'href',
      '/dashboard/settings#notifications',
    )
  })
})
