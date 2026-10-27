import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/legacy/next-scheduled-card', () => ({ NextScheduledCard: () => <p>next scheduled</p> }))
vi.mock('@/components/legacy/notification-status-card', () => ({ NotificationStatusCard: () => <p>channel status</p> }))
vi.mock('@/components/settings/notifications-settings', () => ({ NotificationsSettings: () => <p>channels and schedules</p> }))

import { NotificationsSection } from '@/components/settings/notifications-section'

describe('Settings › Notifiche', () => {
  it('gathers the old notifications page and the dashboard cards under #notifications', () => {
    const { container } = render(<NotificationsSection />)
    const section = container.querySelector('section#notifications')!
    expect(section).not.toBeNull()
    for (const text of ['next scheduled', 'channel status', 'channels and schedules']) {
      expect(section).toContainElement(screen.getByText(text))
    }
  })
})

describe('a link to #notifications', () => {
  it('scrolls to the section once it exists, since the page renders after its data loads', () => {
    window.location.hash = '#notifications'
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<NotificationsSection />)
    expect(scroll).toHaveBeenCalled()
    window.location.hash = ''
  })

  it('leaves the scroll alone otherwise', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<NotificationsSection />)
    expect(scroll).not.toHaveBeenCalled()
  })
})
