'use client';

// Fork: Wearly's menu — Oggi · Armadio · Outfit, plus an "Altro" group. The same entries feed the
// desktop sidebar and the phone's bottom bar (where "Altro" is a page of its own).
import { BarChart3, CalendarCheck, Inbox, LayoutGrid, Settings, Shirt, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBatchUploadEnabled } from '@/lib/hooks/use-batch-inbox';

export interface NavEntry {
  key: string;
  name: string;
  href: string;
  icon: LucideIcon;
}

export const MORE_HREF = '/dashboard/more';

export function useNavigation(): { primary: NavEntry[]; more: NavEntry[] } {
  const t = useTranslations('wearly.nav');
  const batchUpload = useBatchUploadEnabled();
  const entry = (key: string, href: string, icon: LucideIcon): NavEntry => ({ key, name: t(key), href, icon });
  return {
    primary: [
      entry('today', '/dashboard', CalendarCheck),
      entry('wardrobe', '/dashboard/wardrobe', Shirt),
      entry('outfits', '/dashboard/outfits', LayoutGrid),
    ],
    more: [
      ...(batchUpload ? [entry('inbox', '/dashboard/inbox', Inbox)] : []),
      entry('analytics', '/dashboard/analytics', BarChart3),
      entry('settings', '/dashboard/settings', Settings),
    ],
  };
}

/** Home only on an exact match; any other entry also on the pages below it. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
