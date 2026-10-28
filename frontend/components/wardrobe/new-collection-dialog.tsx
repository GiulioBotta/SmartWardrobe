'use client';

// Fork: a new collection — a name and the items picked from the whole wardrobe, some of them
// possibly ticked already (when started from a selection in the wardrobe).
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAllItems, useCreateCollection } from '@/lib/hooks/use-wardrobe-sections';
import { sectionErrorKey } from '@/lib/wardrobe-sections';

interface NewCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItemIds: string[];
}

export function NewCollectionDialog({ open, onOpenChange, initialItemIds }: NewCollectionDialogProps) {
  const t = useTranslations('wardrobeSections');
  const create = useCreateCollection();
  const { items } = useAllItems({ is_archived: false, sort_by: 'category', sort_order: 'asc' }, open);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const initialKey = initialItemIds.join(',');
  useEffect(() => {
    if (open) {
      setName('');
      setPicked(new Set(initialItemIds));
    }
  }, [open, initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    try {
      // Wardrobe order, so the collection lists items the way the gallery showed them; items
      // picked from the wardrobe whose gallery page has not loaded yet follow, never dropped.
      const shown = items.filter((item) => picked.has(item.id)).map((item) => item.id);
      const itemIds = [...shown, ...Array.from(picked).filter((id) => !shown.includes(id))];
      await create.mutateAsync({ name: name.trim(), itemIds });
      toast.success(t('collection.created', { name: name.trim() }));
      onOpenChange(false);
    } catch (error) {
      toast.error(t(sectionErrorKey(error) ?? 'collection.error'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal">{t('collection.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="collection-name">{t('collection.nameLabel')}</Label>
          <Input
            id="collection-name"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('collection.namePlaceholder')}
          />
        </div>
        <p className="label-caps mt-2">{t('collection.pick')}</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item) => {
            const checked = picked.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={item.name ?? item.type}
                onClick={() => toggle(item.id)}
                className={`relative aspect-[4/5] overflow-hidden rounded-xl bg-secondary transition ${
                  checked ? 'ring-2 ring-brand' : 'opacity-80 hover:opacity-100'
                }`}
              >
                {item.thumbnail_url && (
                  <img src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
                )}
                {checked && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-brand p-0.5 text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || create.isPending}>
            {t('collection.create', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
