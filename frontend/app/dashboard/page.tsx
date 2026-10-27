'use client';

// Fork: Wearly's home, "Oggi". Replaces the upstream dashboard: what are you wearing today (a
// suggestion, pieces picked by hand, a recent look again, or the daily notification's proposal),
// what you wore lately, and photos waiting for review. The upstream cards it dropped live on in
// components/legacy (Settings › Notifiche and Analisi).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Loader2, Repeat, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { Greeting } from '@/components/today/greeting';
import { InboxReminder } from '@/components/today/inbox-reminder';
import { ItemPickerGrid } from '@/components/today/item-picker-grid';
import { OutfitStrip } from '@/components/today/outfit-strip';
import { TodayBox } from '@/components/today/today-box';
import { Button } from '@/components/ui/button';
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
  pendingForToday,
  skipSuggestion,
  wearSuggestionToday,
  wornOn,
  wornToday,
} from '@/lib/quick-log';
import type { Outfit } from '@/lib/types';

const REPEAT_WINDOW_DAYS = 14;
const ITEM_PAGE_SIZE = 100;
// Up to 500 pieces; the grid is for picking, not for browsing a huge wardrobe.
const MAX_ITEM_PAGES = 5;
const RECENT_LOOKS = 3;

type Mode = 'none' | 'pick' | 'repeat';

export default function TodayHome() {
  const t = useTranslations('wearly.today');
  const tLog = useTranslations('quickLog');
  const locale = useLocale();
  const occasionLabel = useOccasionLabel();
  const queryClient = useQueryClient();
  const today = useUserToday()();
  const { data: prefs } = usePreferences();
  const [mode, setMode] = useState<Mode>('none');
  const sectionRef = useRef<HTMLElement>(null);

  const { data: outfitList, isLoading: outfitsLoading } = useOutfits(
    { date_from: daysAgo(today, REPEAT_WINDOW_DAYS), date_to: today },
    1,
    100,
  );
  const [pageCount, setPageCount] = useState(1);
  const picking = mode === 'pick';
  const { items, hasMore, isLoading: itemsLoading, isFetching } = useItemPages({}, picking ? pageCount : 0, ITEM_PAGE_SIZE);
  useEffect(() => {
    if (picking && hasMore && !isFetching && pageCount < MAX_ITEM_PAGES) setPageCount((n) => n + 1);
  }, [picking, hasMore, isFetching, pageCount]);

  const outfits = useMemo(() => outfitList?.outfits ?? [], [outfitList]);
  const loggedToday = wornToday(outfits, today);
  const pending = pendingForToday(outfits, today);
  const toRepeat = outfitsToRepeat(outfits, today);
  const groups = useMemo(() => groupBySlot(items), [items]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [occasion, setOccasion] = useState<string | null>(null);
  const chosenOccasion = occasion ?? prefs?.default_occasion ?? 'casual';

  const refreshWearCaches = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.outfits.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.pendingOutfits.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all });
    invalidateEveryItemWearCache(queryClient);
  };

  const log = useMutation({
    mutationFn: (args: { itemIds: string[]; occasion: string }) => logWornToday(args.itemIds, args.occasion, today),
    onSuccess: () => {
      toast.success(tLog('wornLogged'));
      setSelected(new Set());
      setMode('none');
      refreshWearCaches();
    },
    onError: (error) => toast.error(getErrorMessage(error, tLog('wornFailed'))),
  });
  const answer = useMutation({
    mutationFn: ({ outfit, wear }: { outfit: Outfit; wear: boolean }) =>
      wear ? wearSuggestionToday(outfit.id) : skipSuggestion(outfit.id),
    onSuccess: (_, { wear }) => {
      if (wear) toast.success(tLog('wornLogged'));
      refreshWearCaches();
    },
    onError: (error) => toast.error(getErrorMessage(error, tLog('wornFailed'))),
  });

  const open = (next: Mode) => {
    setMode(next);
    // Let the section render, then bring it into view on a phone.
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const toggle = (itemId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-40 lg:pb-24">
      <Greeting today={today} />

      {outfitsLoading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : (
        <TodayBox
          loggedToday={loggedToday}
          pending={pending}
          busy={answer.isPending}
          onPick={() => open('pick')}
          onRepeat={() => open('repeat')}
          onWear={(outfit) => answer.mutate({ outfit, wear: true })}
          onSkip={(outfit) => answer.mutate({ outfit, wear: false })}
        />
      )}

      {mode !== 'none' && (
        <section ref={sectionRef} className="scroll-mt-20 space-y-3" aria-labelledby="today-mode-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="today-mode-title" className="font-serif text-xl">
              {mode === 'pick' ? t('pickTitle') : t('repeatTitle')}
            </h2>
            <Button variant="ghost" size="icon" onClick={() => setMode('none')} aria-label={t('close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {mode === 'pick' ? (
            <>
              <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
              {itemsLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noItems')}</p>
              ) : (
                <ItemPickerGrid groups={groups} selected={selected} onToggle={toggle} />
              )}
            </>
          ) : toRepeat.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('nothingToRepeat')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {toRepeat.map((outfit) => (
                <div key={outfit.id} data-testid="repeat-outfit" className="space-y-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{outfit.name || occasionLabel(outfit.occasion)}</span>
                    <span className="label-caps shrink-0">{dayLabel(wornOn(outfit)!)}</span>
                  </div>
                  <OutfitStrip items={outfit.items} />
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={log.isPending}
                    onClick={() => log.mutate({ itemIds: outfit.items.map((i) => i.id), occasion: outfit.occasion })}
                  >
                    <Repeat className="mr-1 h-4 w-4" />
                    {t('repeatThis')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {mode === 'none' && toRepeat.length > 0 && (
        <section className="space-y-3" aria-labelledby="today-recent-title">
          <h2 id="today-recent-title" className="label-caps">{t('recentTitle')}</h2>
          <div className="space-y-3">
            {toRepeat.slice(0, RECENT_LOOKS).map((outfit) => (
              <div key={outfit.id} className="flex items-center gap-3">
                <span className="label-caps w-20 shrink-0">{dayLabel(wornOn(outfit)!)}</span>
                <OutfitStrip items={outfit.items} />
              </div>
            ))}
          </div>
        </section>
      )}

      <InboxReminder />

      {picking && selected.size > 0 && (
        // Above the mobile bottom navigation (h-16), flush with the bottom next to the sidebar.
        <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-card p-3 shadow-lg lg:bottom-0 lg:left-72">
          <div className="mx-auto max-w-5xl space-y-2">
            {/* One scrolling row, so the bar does not cover half the grid on a phone. */}
            <div className="-mx-3 overflow-x-auto px-3 pb-1 [&>div]:flex-nowrap [&_button]:shrink-0">
              <OccasionChips selected={chosenOccasion} onSelect={setOccasion} extraOccasions={[prefs?.default_occasion]} />
            </div>
            <div className="flex items-center gap-2">
              <span className="mr-auto text-sm font-medium">{tLog('selected', { count: selected.size })}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={tLog('clear')}>
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                disabled={log.isPending}
                onClick={() => log.mutate({ itemIds: Array.from(selected), occasion: chosenOccasion })}
              >
                {log.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1 h-4 w-4" />}
                {tLog('save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
