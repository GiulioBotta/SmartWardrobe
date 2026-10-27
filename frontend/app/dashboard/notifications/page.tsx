'use client';

// Fork: notifications are a section of Settings now; middleware redirects this address there.
import { NotificationsSettings } from '@/components/settings/notifications-settings';

export default function NotificationsPage() {
  return <NotificationsSettings />;
}
