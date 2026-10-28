'use client';

// Fork: the wardrobe selection bar's collection actions — start a new collection with the
// selected items, add them to one, or take them out of one.
import { BookmarkPlus, ListMinus, ListPlus } from 'lucide-react';
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

interface CollectionActionsProps {
  selectedIds: string[];
  onNewCollection: (itemIds: string[]) => void;
}

export function CollectionActions({ selectedIds, onNewCollection }: CollectionActionsProps) {
  const t = useTranslations('wardrobeSections');
  const { data: sections = [] } = useWardrobeSections();
  const collectionItems = useCollectionItems();
  const collections = sections.filter((s) => s.kind === 'collection');

  const apply = async (id: string, name: string, remove: boolean) => {
    try {
      await collectionItems.mutateAsync(
        remove ? { id, itemIds: selectedIds, remove: true } : { id, itemIds: selectedIds },
      );
      toast.success(t(remove ? 'collection.removed' : 'collection.added', { name }));
    } catch {
      toast.error(t('collection.error'));
    }
  };

  const menu = (label: string, Icon: typeof ListPlus, remove: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={label}
          title={label}
          disabled={selectedIds.length === 0}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {collections.length === 0 ? (
          <DropdownMenuItem disabled>{t('collection.none')}</DropdownMenuItem>
        ) : (
          collections.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => apply(c.id, c.name ?? '', remove)}>
              {c.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label={t('collection.new')}
        title={t('collection.new')}
        onClick={() => onNewCollection(selectedIds)}
      >
        <BookmarkPlus className="h-4 w-4" />
      </Button>
      {menu(t('collection.addTo'), ListPlus, false)}
      {menu(t('collection.removeFrom'), ListMinus, true)}
    </>
  );
}
