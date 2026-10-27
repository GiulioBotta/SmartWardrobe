'use client';

// Fork: moved unchanged from the upstream dashboard, which Wearly's "Oggi" home replaced.
import { TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics } from '@/lib/hooks/use-analytics';

export function WeeklySummaryCard() {
  const { data: analytics, isLoading } = useAnalytics();
  const t = useTranslations('dashboard');

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {t('weeklySummary.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (!analytics) {
    return null;
  }

  const { wardrobe } = analytics;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {t('weeklySummary.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-bold">{wardrobe.outfits_this_week}</p>
            <p className="text-xs text-muted-foreground">{t('weeklySummary.outfits')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold">
              {wardrobe.acceptance_rate != null ? `${wardrobe.acceptance_rate}%` : '-'}
            </p>
            <p className="text-xs text-muted-foreground">{t('weeklySummary.accepted')}</p>
          </div>
        </div>
        {wardrobe.average_rating != null && (
          <p className="text-xs text-muted-foreground mt-2">
            {t('weeklySummary.avgRatingValue', { rating: wardrobe.average_rating })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
