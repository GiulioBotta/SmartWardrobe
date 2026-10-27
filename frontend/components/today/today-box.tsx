'use client';

// Fork: the "Cosa indossi oggi?" box at the top of Wearly's home.
import Link from 'next/link';
import { CalendarCheck, Plus, Repeat, Shirt, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OutfitStrip } from '@/components/today/outfit-strip';
import { Button } from '@/components/ui/button';
import { useOccasionLabel } from '@/lib/hooks/use-translated-constants';
import type { Outfit } from '@/lib/types';

interface TodayBoxProps {
  loggedToday: Outfit[];
  // The daily notification's look for today, still unanswered.
  pending: Outfit | null;
  busy: boolean;
  onPick: () => void;
  onRepeat: () => void;
  onWear: (outfit: Outfit) => void;
  onSkip: (outfit: Outfit) => void;
}

export function TodayBox({ loggedToday, pending, busy, onPick, onRepeat, onWear, onSkip }: TodayBoxProps) {
  const t = useTranslations('wearly');
  const occasionLabel = useOccasionLabel();

  return (
    <section className="space-y-4 rounded-2xl bg-secondary p-5" aria-labelledby="today-box-title">
      {loggedToday.length > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 id="today-box-title" className="font-serif text-xl">{t('today.loggedTitle')}</h2>
          </div>
          {loggedToday.map((outfit) => (
            <div key={outfit.id} className="space-y-1">
              <p className="label-caps">{outfit.name || occasionLabel(outfit.occasion)}</p>
              <OutfitStrip items={outfit.items} />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={onPick}>
            <Plus className="mr-1 h-4 w-4" />
            {t('today.addAnother')}
          </Button>
        </>
      ) : pending ? (
        <>
          <div>
            <p className="label-caps">{t('today.question')}</p>
            <h2 id="today-box-title" className="mt-1 font-serif text-xl">{t('today.proposedTitle')}</h2>
            <p className="text-sm text-muted-foreground">{pending.name || occasionLabel(pending.occasion)}</p>
          </div>
          <OutfitStrip items={pending.items} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onWear(pending)}>
              <CalendarCheck className="mr-1 h-4 w-4" />
              {t('today.wearIt')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => onSkip(pending)}>
              {t('today.skip')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 id="today-box-title" className="font-serif text-2xl">{t('today.question')}</h2>
            <p className="text-sm text-muted-foreground">{t('today.nothingYet')}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/dashboard/suggest">
              <Sparkles className="mr-2 h-4 w-4" />
              {t('today.suggest')}
            </Link>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onPick}>
              <Shirt className="mr-1 h-4 w-4" />
              {t('today.pick')}
            </Button>
            <Button variant="outline" onClick={onRepeat}>
              <Repeat className="mr-1 h-4 w-4" />
              {t('today.repeat')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
