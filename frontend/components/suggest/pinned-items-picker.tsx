'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Plus, Shirt, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ItemPicker } from '@/components/shared/item-picker';
import { useTypeLabel } from '@/lib/hooks/use-translated-constants';
import { ClothingTypeValue, Item } from '@/lib/types';
import { MAX_PINNED_ITEMS } from '@/lib/suggest-filters';

const PICKER_FILTER_TYPES = [
  'shirt', 't-shirt', 'pants', 'jeans', 'shoes', 'sneakers', 'jacket', 'dress',
] as const satisfies readonly ClothingTypeValue[];

export function PinnedItemsPicker({
  items,
  onChange,
}: {
  items: Item[];
  onChange: (items: Item[]) => void;
}) {
  const t = useTranslations('smartSuggest.pinned');
  const tCommon = useTranslations('common');
  const tTypes = useTranslations('constants.types');
  const tBase = useTranslations('suggest.baseItem');
  const typeLabel = useTypeLabel();
  const [isOpen, setIsOpen] = useState(false);
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const selectedIds = new Set(items.map((i) => i.id));
  const isFull = items.length >= MAX_PINNED_ITEMS;

  const toggle = (item: Item) => {
    if (selectedIds.has(item.id)) onChange(items.filter((i) => i.id !== item.id));
    else if (!isFull) onChange([...items, item]);
  };

  return (
    <div className="space-y-3 pt-1 border-t">
      <div className="space-y-0.5">
        <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t('title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('subtitle', { max: MAX_PINNED_ITEMS })}</p>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="pinned-items">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2 rounded-xl border bg-card/80 shadow-sm gap-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative w-11 h-11 rounded-lg overflow-hidden border bg-muted flex-shrink-0">
                  {item.thumbnail_url || item.image_url ? (
                    <Image
                      src={(item.thumbnail_url || item.image_url)!}
                      alt={item.name || typeLabel(item.type)}
                      fill
                      className="object-cover"
                      sizes="44px"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Shirt className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <Badge variant="secondary" className="text-[10px] capitalize px-1.5 py-0">
                    {typeLabel(item.type)}
                  </Badge>
                  <p className="text-sm font-medium truncate">{item.name || typeLabel(item.type)}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => toggle(item)}
                className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                title={t('remove')}
                aria-label={t('remove')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {!isFull && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12 border-dashed border-2 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/60 hover:bg-primary/5"
          onClick={() => setIsOpen(true)}
          data-testid="pinned-add"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">{items.length ? t('addAnother') : t('add')}</span>
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t('dialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('dialogDescription', { count: items.length, max: MAX_PINNED_ITEMS })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-none">
            {[
              { label: tBase('all'), value: undefined },
              ...PICKER_FILTER_TYPES.map((value) => ({ label: tTypes(value), value })),
            ].map((cat) => (
              <Button
                key={cat.value ?? 'all'}
                type="button"
                variant={filterType === cat.value ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-7 px-2.5 rounded-full flex-shrink-0"
                onClick={() => setFilterType(cat.value)}
              >
                {cat.label}
              </Button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden min-h-0 pt-1">
            <ItemPicker
              key={filterType ?? 'all'}
              selectedIds={selectedIds}
              onToggle={toggle}
              filterType={filterType}
              hideNeedsWash={true}
              heightClass="h-[340px]"
            />
          </div>

          <div className="flex justify-between items-center pt-3 border-t mt-2">
            {items.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t('clear')}
              </Button>
            ) : (
              <div />
            )}
            <Button type="button" size="sm" onClick={() => setIsOpen(false)} data-testid="pinned-done">
              {tCommon('done')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
