'use client';

import { AlertTriangle, Copy, Loader2, Pencil, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { primaryPhoto, type Garment } from '@/lib/batch-inbox';
import { useColorLabel, useTypeLabel } from '@/lib/hooks/use-translated-constants';
import { cn } from '@/lib/utils';

interface GarmentCardProps {
  garment: Garment;
  selected: boolean;
  busy: boolean;
  onSelect: (selected: boolean) => void;
  onEdit: () => void;
  onConfirm: () => void;
  onRetag: () => void;
  onAttach: () => void;
  onNotDuplicate: () => void;
}

export function GarmentCard({
  garment,
  selected,
  busy,
  onSelect,
  onEdit,
  onConfirm,
  onRetag,
  onAttach,
  onNotDuplicate,
}: GarmentCardProps) {
  const t = useTranslations('batchInbox');
  const typeLabel = useTypeLabel();
  const colorLabel = useColorLabel();
  const primary = primaryPhoto(garment);
  const tags = primary.tags ?? {};
  const others = garment.photos.filter((p) => p.id !== primary.id);
  const analyzing = primary.status === 'tagging';
  const failed = primary.status === 'error';
  const duplicate = garment.duplicate_item;
  const title =
    tags.name ||
    [tags.type && tags.type !== 'unknown' ? typeLabel(tags.type) : null, tags.primary_color ? colorLabel(tags.primary_color) : null]
      .filter(Boolean)
      .join(' · ') ||
    t('card.untitled');

  return (
    <Card
      className={cn('overflow-hidden', selected && 'ring-2 ring-primary')}
      data-testid="garment-card"
    >
      <div className="relative aspect-square bg-muted">
        {primary.medium_url && (
          <img src={primary.medium_url} alt={title} className="h-full w-full object-contain" />
        )}
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onSelect(value === true)}
          className="absolute left-2 top-2 h-5 w-5 bg-background"
          aria-label={t('card.select', { name: title })}
        />
        {others.length > 0 && (
          <div className="absolute bottom-2 left-2 flex gap-1">
            {others.slice(0, 3).map((photo) => (
              <img
                key={photo.id}
                src={photo.thumbnail_url ?? undefined}
                alt=""
                className="h-10 w-10 rounded border bg-background object-cover"
              />
            ))}
            {others.length > 3 && (
              <span className="flex h-10 w-10 items-center justify-center rounded border bg-background text-xs">
                +{others.length - 3}
              </span>
            )}
          </div>
        )}
        {analyzing && (
          <Badge variant="secondary" className="absolute right-2 top-2 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('card.analyzing')}
          </Badge>
        )}
        {failed && (
          <Badge variant="destructive" className="absolute right-2 top-2">
            {t('card.failed')}
          </Badge>
        )}
      </div>
      <CardContent className="space-y-2 p-3">
        <div>
          <p className="truncate font-serif text-[0.95rem]" title={title}>{title}</p>
          {tags.brand && <p className="truncate text-sm text-muted-foreground">{tags.brand}</p>}
          {failed && primary.error && (
            <p className="line-clamp-2 text-xs text-destructive" title={primary.error}>{primary.error}</p>
          )}
          {garment.blocked_reason === 'type missing' && !failed && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('card.typeMissing')}</p>
          )}
        </div>

        {duplicate && (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              {duplicate.thumbnail_url && (
                <img src={duplicate.thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />
              )}
              <span>
                {t('card.duplicateOf', {
                  name: duplicate.name || typeLabel(duplicate.type),
                })}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-auto whitespace-normal py-1.5 text-left"
                disabled={busy}
                onClick={onAttach}
              >
                <Copy className="mr-1 h-3 w-3 shrink-0" />
                {t('card.attach')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-auto whitespace-normal py-1.5"
                disabled={busy}
                onClick={onNotDuplicate}
              >
                {t('card.notDuplicate')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 sm:flex-row">
          <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={onEdit}>
            <Pencil className="mr-1 h-3 w-3" />
            {t('card.edit')}
          </Button>
          {failed ? (
            <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={onRetag}>
              <RotateCcw className="mr-1 h-3 w-3" />
              {t('card.retry')}
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || garment.blocked_reason !== null}
              onClick={onConfirm}
            >
              {t('card.confirm')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
