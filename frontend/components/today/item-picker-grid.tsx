'use client';

import { Check, Shirt } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SLOT_ORDER, type Slot } from '@/lib/quick-log';
import { useTypeLabel } from '@/lib/hooks/use-translated-constants';
import type { Item } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ItemPickerGridProps {
  groups: Record<Slot, Item[]>;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
}

/** The wardrobe by slot, one tap to pick or drop a piece. */
export function ItemPickerGrid({ groups, selected, onToggle }: ItemPickerGridProps) {
  const t = useTranslations('quickLog');
  const typeLabel = useTypeLabel();
  return (
    <div className="space-y-5">
      {SLOT_ORDER.filter((slot) => groups[slot].length > 0).map((slot) => (
        <section key={slot} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{t(`slots.${slot}`)}</h3>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {groups[slot].map((item) => {
              const isSelected = selected.has(item.id);
              const label = item.name || typeLabel(item.type);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggle(item.id)}
                  aria-pressed={isSelected}
                  aria-label={label}
                  title={label}
                  data-testid="today-item"
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-md border bg-muted transition',
                    isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:opacity-80',
                  )}
                >
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Shirt className="m-auto h-6 w-6 text-muted-foreground" />
                  )}
                  {isSelected && (
                    <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
