'use client';

// Fork: Settings › Notifiche — the upstream notifications page plus the two notification cards
// the old dashboard had. Old links to /dashboard/notifications land here (#notifications).
import { useEffect, useRef } from 'react';
import { NextScheduledCard } from '@/components/legacy/next-scheduled-card';
import { NotificationStatusCard } from '@/components/legacy/notification-status-card';
import { NotificationsSettings } from '@/components/settings/notifications-settings';

export function NotificationsSection() {
  const ref = useRef<HTMLElement>(null);
  // Settings renders after its data loads, too late for the browser's own jump to the anchor.
  useEffect(() => {
    if (window.location.hash === '#notifications') ref.current?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <section ref={ref} id="notifications" className="scroll-mt-20 space-y-6 border-t pt-8">
      <div className="grid gap-4 md:grid-cols-2">
        <NextScheduledCard />
        <NotificationStatusCard />
      </div>
      <NotificationsSettings />
    </section>
  );
}
