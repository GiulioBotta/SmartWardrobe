'use client';

// Fork: the wardrobe card only showed a heart for favourites; this one toggles it in place,
// without opening the item. Always visible, since phones have no hover.
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUpdateItem } from '@/lib/hooks/use-items';
import type { Item } from '@/lib/types';

export function FavoriteToggle({ item }: { item: Pick<Item, 'id' | 'favorite'> }) {
  const t = useTranslations('wardrobe.itemDetail.titles');
  const updateItem = useUpdateItem();

  return (
    <button
      type="button"
      aria-pressed={item.favorite}
      aria-label={t('toggleFavorite')}
      title={t('toggleFavorite')}
      disabled={updateItem.isPending}
      onClick={(e) => {
        e.stopPropagation();
        updateItem.mutate({ id: item.id, data: { favorite: !item.favorite } });
      }}
      className="rounded-full bg-background/80 p-1.5 backdrop-blur-sm transition-transform hover:scale-110 disabled:opacity-60"
    >
      <Heart
        className={`h-4 w-4 ${item.favorite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`}
      />
    </button>
  );
}
