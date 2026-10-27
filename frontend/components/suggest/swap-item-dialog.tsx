'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Loader2, RefreshCw, Shirt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api, ApiError } from '@/lib/api';
import { applySessionToken } from '@/lib/hooks/use-session-token';
import { useTypeLabel } from '@/lib/hooks/use-translated-constants';
import { Outfit, OutfitItem } from '@/lib/types';
import { cn } from '@/lib/utils';

export function SwapItemDialog({
  outfit,
  item,
  onClose,
  onSwapped,
}: {
  outfit: Outfit;
  item: OutfitItem | null;
  onClose: () => void;
  onSwapped: (outfit: Outfit) => void;
}) {
  const t = useTranslations('smartSuggest.swap');
  const typeLabel = useTypeLabel();
  const { data: session } = useSession();
  const [options, setOptions] = useState<OutfitItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setOptions(null);
    setError(null);
    applySessionToken(session);
    api
      .get<OutfitItem[]>(`/outfits/${outfit.id}/swap-options?item_id=${item.id}`)
      .then((result) => !cancelled && setOptions(result))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t('error')));
    return () => {
      cancelled = true;
    };
    // session only supplies the token; refetching on every session poll is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfit.id, item?.id]);

  const choose = async (replacement: OutfitItem) => {
    if (!item) return;
    setSavingId(replacement.id);
    setError(null);
    try {
      applySessionToken(session);
      const items = outfit.items.map((i) => (i.id === item.id ? replacement.id : i.id));
      const updated = await api.patch<Outfit>(`/outfits/${outfit.id}`, { items });
      onSwapped(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
    } finally {
      setSavingId(null);
    }
  };

  const itemLabel = item ? item.name || typeLabel(item.type) : '';

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            {t('title', { item: itemLabel })}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {options === null && !error ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : options && options.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t('none')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" data-testid="swap-options">
            {(options ?? []).map((option, index) => (
              <button
                key={option.id}
                type="button"
                disabled={savingId !== null}
                onClick={() => choose(option)}
                data-testid="swap-option"
                className={cn(
                  'group relative rounded-xl border overflow-hidden bg-muted/30 text-left hover:shadow-md hover:border-primary/60 transition-all disabled:opacity-60',
                  index === 0 && 'ring-2 ring-primary/20 border-primary/40'
                )}
              >
                <div className="aspect-square relative">
                  {option.thumbnail_url ? (
                    <Image
                      src={option.thumbnail_url}
                      alt={option.name || typeLabel(option.type)}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Shirt className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                  {savingId === option.id && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs sm:text-sm font-medium truncate">
                    {option.name || typeLabel(option.type)}
                  </p>
                  {index === 0 && <p className="text-[10px] text-primary">{t('bestMatch')}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
