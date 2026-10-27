'use client';

// Fork: the Outfit page holds the looks and, since the Wearly redesign, the suggestion history
// (formerly its own page). The tab lives in the address (?tab=history), so old links land on it.
import type { ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

type Tab = 'looks' | 'history';

export function OutfitsTabs({ looks, history }: { looks: ReactNode; history: ReactNode }) {
  const t = useTranslations('wearly.outfits.tabs');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current: Tab = searchParams.get('tab') === 'history' ? 'history' : 'looks';

  // The looks' own parameters (filter, view, month) mean nothing to the history, and back again.
  const select = (tab: Tab) => {
    if (tab === current) return;
    router.replace(tab === 'history' ? `${pathname}?tab=history` : pathname);
  };

  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex rounded-full bg-secondary p-1">
        {(['looks', 'history'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={current === tab}
            onClick={() => select(tab)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm transition-colors',
              current === tab ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(tab)}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current === 'history' ? history : looks}</div>
    </div>
  );
}
