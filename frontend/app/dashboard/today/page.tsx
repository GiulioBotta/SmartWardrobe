'use client';

// Fork: quick wear log — what's logged today, a past look worn again, or pieces picked by hand.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Loader2, Repeat, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { ItemPickerGrid } from '@/components/today/item-picker-grid';
import { OutfitStrip } from '@/components/today/outfit-strip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/api';
import { invalidateEveryItemWearCache } from '@/lib/hooks/cache-invalidation';
import { queryKeys } from '@/lib/hooks/query-keys';
import { useItemPages } from '@/lib/hooks/use-items';
import { useOutfits } from '@/lib/hooks/use-outfits';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useOccasionLabel } from '@/lib/hooks/use-translated-constants';
import { useUserToday } from '@/lib/hooks/use-user';
import {
  daysAgo,
  groupBySlot,
  logWornToday,
  outfitsToRepeat,
  wornOn,
  wornToday,
} from '@/lib/quick-log';
import type { Outfit } from '@/lib/types';

const REPEAT_WINDOW_DAYS = 14;
const ITEM_PAGE_SIZE = 100;
// Up to 500 pieces; the grid is for picking, not for browsing a huge wardrobe.
const MAX_ITEM_PAGES = 5;

export default function TodayPage() {
  const t = useTranslations('quickLog');
  const locale = useLocale();
  const occasionLabel = useOccasionLabel();
  const queryClient = useQueryClient();
  const today = useUserToday()();
  const { data: prefs } = usePreferences();

  const { data: outfitList, isLoading: outfitsLoading } = useOutfits(
    { date_from: daysAgo(today, REPEAT_WINDOW_DAYS), date_to: today },
    1,
    100,
  );
  const [pageCount, setPageCount] = useState(1);
  const { items, hasMore, isLoading: itemsLoading, isFetching } = useItemPages({}, pageCount, ITEM_PAGE_SIZE);
  useEffect(() => {
    if (hasMore && !isFetching && pageCount < MAX_ITEM_PAGES) setPageCount((n) => n + 1);
  }, [hasMore, isFetching, pageCount]);

  const outfits = useMemo(() => outfitList?.outfits ?? [], [outfitList]);
  const loggedToday = wornToday(outfits, today);
  const toRepeat = outfitsToRepeat(outfits, today);
  const groups = useMemo(() => groupBySlot(items), [items]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [occasion, setOccasion] = useState<string | null>(null);
  const chosenOccasion = occasion ?? prefs?.default_occasion ?? 'casual';

  const log = useMutation({
    mutationFn: (args: { itemIds: string[]; occasion: string }) =>
      logWornToday(args.itemIds, args.occasion, today),
    onSuccess: () => {
      toast.success(t('wornLogged'));
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: queryKeys.outfits.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
      invalidateEveryItemWearCache(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error, t('wornFailed'))),
  });

  const toggle = (itemId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const repeat = (outfit: Outfit) =>
    log.mutate({ itemIds: outfit.items.map((i) => i.id), occasion: outfit.occasion });

  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="space-y-8 pb-40 lg:pb-24">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <section className="space-y-3" aria-labelledby="today-logged">
        <h2 id="today-logged" className="font-semibold">{t('loggedToday')}</h2>
        {outfitsLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : loggedToday.length > 0 ? (
          <div className="space-y-2">
            {loggedToday.map((outfit) => (
              <Card key={outfit.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <CalendarCheck className="h-5 w-5 shrink-0 text-green-600" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium">{outfit.name || occasionLabel(outfit.occasion)}</p>
                    <OutfitStrip items={outfit.items} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-muted-foreground">
              {t('nothingYet')}
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/suggest">
                  <Sparkles className="mr-1 h-4 w-4" />
                  {t('getSuggestion')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {toRepeat.length > 0 && (
        <section className="space-y-3" aria-labelledby="today-repeat">
          <h2 id="today-repeat" className="font-semibold">{t('repeatTitle')}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {toRepeat.map((outfit) => (
              <Card key={outfit.id} data-testid="repeat-outfit">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{outfit.name || occasionLabel(outfit.occasion)}</span>
                    <span className="shrink-0 text-muted-foreground">{dayLabel(wornOn(outfit)!)}</span>
                  </div>
                  <OutfitStrip items={outfit.items} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={log.isPending}
                    onClick={() => repeat(outfit)}
                  >
                    <Repeat className="mr-1 h-4 w-4" />
                    {t('repeat')}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="today-pick">
        <div>
          <h2 id="today-pick" className="font-semibold">{t('pickTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
        </div>
        {itemsLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noItems')}</p>
        ) : (
          <ItemPickerGrid groups={groups} selected={selected} onToggle={toggle} />
        )}
      </section>

      {selected.size > 0 && (
        // Above the mobile bottom navigation (h-16), flush with the bottom next to the sidebar.
        <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-card p-3 shadow-lg lg:bottom-0 lg:left-72">
          <div className="mx-auto max-w-5xl space-y-2">
            {/* One scrolling row, so the bar does not cover half the grid on a phone. */}
            <div className="-mx-3 overflow-x-auto px-3 pb-1 [&>div]:flex-nowrap [&_button]:shrink-0">
              <OccasionChips selected={chosenOccasion} onSelect={setOccasion} extraOccasions={[prefs?.default_occasion]} />
            </div>
            <div className="flex items-center gap-2">
              <span className="mr-auto text-sm font-medium">{t('selected', { count: selected.size })}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={t('clear')}>
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                disabled={log.isPending}
                onClick={() => log.mutate({ itemIds: Array.from(selected), occasion: chosenOccasion })}
              >
                {log.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarCheck className="mr-1 h-4 w-4" />
                )}
                {t('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
