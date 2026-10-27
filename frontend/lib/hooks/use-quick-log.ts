'use client';

// Fork: sidebar entry for the quick wear log page.
import { CalendarCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function useTodayNavItem() {
  const t = useTranslations('quickLog');
  return { name: t('nav'), href: '/dashboard/today', icon: CalendarCheck };
}
