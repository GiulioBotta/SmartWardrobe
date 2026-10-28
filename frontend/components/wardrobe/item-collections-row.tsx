'use client';

// Fork: in the item detail, the collections the item is in, with add and remove.
import { Bookmark, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCollectionItems, useWardrobeSections } from '@/lib/hooks/use-wardrobe-sections';

export function ItemCollectionsRow({ itemId }: { itemId: string }) {
  const t = useTranslations('wardrobeSections');
  const { data: sections = [] } = useWardrobeSections();
  const collectionItems = useCollectionItems();
  const collections = sections.filter((s) => s.kind === 'collection');
  const mine = collections.filter((c) => c.item_ids.includes(itemId));
  const others = collections.filter((c) => !c.item_ids.includes(itemId));

  const run = async (vars: { id: string; itemIds: string[]; remove?: boolean }) => {
    try {
      await collectionItems.mutateAsync(vars);
    } catch {
      toast.error(t('collection.error'));
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="label-caps flex items-center gap-1.5">
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        {t('collection.rowLabel')}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {mine.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs"
          >
            {c.name}
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={t('collection.removeItem', { name: c.name ?? '' })}
              onClick={() => run({ id: c.id, itemIds: [itemId], remove: true })}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {others.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" aria-label={t('collection.addItem')}>
                <Plus className="h-3 w-3" />
                {mine.length === 0 && t('collection.addItem')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {others.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => run({ id: c.id, itemIds: [itemId] })}>
                  {c.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
