'use client';

// Fork: moved from the upstream dashboard, which Wearly's "Oggi" home replaced. Its links now
// point at Settings › Notifiche, where the card lives.
import { useMemo } from 'react';
import Link from 'next/link';
import { Calendar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSchedules } from '@/lib/hooks/use-notifications';
import { useOccasionLabel } from '@/lib/hooks/use-translated-constants';
import { useUserTimezone } from '@/lib/hooks/use-user';
import { findNextSchedule } from '@/lib/schedules';

export function NextScheduledCard() {
  const { data: schedules, isLoading } = useSchedules();
  const timezone = useUserTimezone();
  const t = useTranslations('dashboard');
  const tDays = useTranslations('notifications');
  const occasionLabel = useOccasionLabel();

  const nextSchedule = useMemo(
    () => (schedules ? findNextSchedule(schedules, timezone) : null),
    [schedules, timezone]
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t('nextScheduled.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-6 w-32 mb-1" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  if (!nextSchedule) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t('nextScheduled.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">{t('nextScheduled.noSchedules')}</p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/settings#notifications">{t('nextScheduled.setUpSchedule')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { schedule, notifyDay, daysUntil } = nextSchedule;
  const timeStr = schedule.notification_time.slice(0, 5);
  const dayNames = [
    tDays('days.monday'), tDays('days.tuesday'), tDays('days.wednesday'),
    tDays('days.thursday'), tDays('days.friday'), tDays('days.saturday'),
    tDays('days.sunday'),
  ];
  const dayStr = daysUntil === 0 ? t('nextScheduled.today') : daysUntil === 1 ? t('nextScheduled.tomorrow') : dayNames[notifyDay];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          {t('nextScheduled.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-semibold">
          {t('nextScheduled.dayAtTime', { day: dayStr, time: timeStr })}
        </p>
        <p className="text-sm text-muted-foreground capitalize">
          {t('nextScheduled.occasionOutfit', { occasion: occasionLabel(schedule.occasion) })}
        </p>
        {daysUntil === 0 && (
          <Badge variant="secondary" className="mt-2">{t('nextScheduled.comingUp')}</Badge>
        )}
      </CardContent>
    </Card>
  );
}
