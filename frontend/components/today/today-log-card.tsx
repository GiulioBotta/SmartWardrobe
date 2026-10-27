'use client';

// Fork: dashboard entry to the quick wear log. A plain link on purpose: the dashboard's own
// tests stub its data hooks one by one, and what is logged today is shown on the page itself.
import Link from 'next/link';
import { CalendarCheck, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';

export function TodayLogCard() {
  const t = useTranslations('quickLog');
  return (
    <Link href="/dashboard/today" className="block" data-testid="today-log-card">
      <Card className="transition-colors hover:bg-accent/50">
        <CardContent className="flex items-center gap-3 p-4">
          <CalendarCheck className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <p className="font-medium">{t('card.question')}</p>
            <p className="text-sm text-muted-foreground">{t('card.hint')}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
