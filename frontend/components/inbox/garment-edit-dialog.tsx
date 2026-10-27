'use client';

import { useEffect, useState } from 'react';
import { Scissors, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { primaryPhoto, type Garment, type GarmentChanges, type GarmentTags } from '@/lib/batch-inbox';
import { FORMALITY_VALUES, MATERIAL_VALUES } from '@/lib/generated/garment-vocabulary';
import {
  useClothingColors,
  useClothingTypes,
  useFormalityLabel,
  useMaterialLabel,
  usePatternLabel,
  useSeasonLabel,
} from '@/lib/hooks/use-translated-constants';

const PATTERN_VALUES = [
  'solid', 'striped', 'checkered', 'plaid', 'floral', 'polka-dot',
  'geometric', 'graphic', 'animal-print', 'camouflage',
] as const;
const SEASON_VALUES = ['spring', 'summer', 'fall', 'winter', 'all-season'] as const;
// Select needs a non-empty value for "leave as it is" / "not set".
const KEEP = '__keep';

type SelectField = 'type' | 'primary_color' | 'pattern' | 'material' | 'formality';
type TextField = 'name' | 'brand';

interface FormState {
  type: string;
  primary_color: string;
  pattern: string;
  material: string;
  formality: string;
  name: string;
  brand: string;
  season: string[] | null;
}

function formFrom(tags: GarmentTags | null): FormState {
  return {
    type: tags?.type && tags.type !== 'unknown' ? tags.type : KEEP,
    primary_color: tags?.primary_color ?? KEEP,
    pattern: tags?.pattern ?? KEEP,
    material: tags?.material ?? KEEP,
    formality: tags?.formality ?? KEEP,
    name: tags?.name ?? '',
    brand: tags?.brand ?? '',
    season: tags ? (tags.season ?? []) : null,
  };
}

/** The fields the user actually changed, compared with where the form started. */
export function changedFields(start: FormState, current: FormState): GarmentChanges {
  const changes: GarmentChanges = {};
  for (const field of ['type', 'primary_color', 'pattern', 'material', 'formality'] as SelectField[]) {
    if (current[field] !== start[field] && current[field] !== KEEP) changes[field] = current[field];
  }
  for (const field of ['name', 'brand'] as TextField[]) {
    if (current[field].trim() !== start[field].trim()) changes[field] = current[field].trim() || null;
  }
  if (
    current.season !== null &&
    JSON.stringify([...current.season].sort()) !== JSON.stringify([...(start.season ?? [])].sort())
  ) {
    changes.season = current.season;
  }
  return changes;
}

interface GarmentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // One garment to edit, or several (bulk edit: only the fields set are applied).
  garments: Garment[];
  busy: boolean;
  onSave: (changes: GarmentChanges) => void;
  onSplit: (photoId: string) => void;
  onDiscard: () => void;
}

export function GarmentEditDialog({
  open,
  onOpenChange,
  garments,
  busy,
  onSave,
  onSplit,
  onDiscard,
}: GarmentEditDialogProps) {
  const t = useTranslations('batchInbox');
  const types = useClothingTypes();
  const colors = useClothingColors();
  const patternLabel = usePatternLabel();
  const materialLabel = useMaterialLabel();
  const formalityLabel = useFormalityLabel();
  const seasonLabel = useSeasonLabel();
  const single = garments.length === 1 ? garments[0] : null;
  // Taken when the dialog opens: the page polls while photos are analyzed, and a refetch
  // must not wipe what the user is typing.
  const [start, setStart] = useState<FormState>(() => formFrom(null));
  const [form, setForm] = useState<FormState>(start);
  const garmentKey = garments.map((g) => g.group_id).join(',');
  useEffect(() => {
    if (!open) return;
    const initial = formFrom(single ? primaryPhoto(single).tags : null);
    setStart(initial);
    setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open or another garment
  }, [open, garmentKey]);

  const changes = changedFields(start, form);
  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const select = (field: SelectField, label: string, options: { value: string; label: string }[]) => (
    <div className="space-y-1">
      <Label htmlFor={`garment-${field}`}>{label}</Label>
      <Select value={form[field]} onValueChange={(value) => set(field, value)}>
        <SelectTrigger id={`garment-${field}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP}>{single ? t('edit.notSet') : t('edit.keep')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {single ? t('edit.title') : t('edit.bulkTitle', { count: garments.length })}
          </DialogTitle>
          <DialogDescription>
            {single ? t('edit.description') : t('edit.bulkDescription')}
          </DialogDescription>
        </DialogHeader>

        {single && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {single.photos.map((photo) => (
              <div key={photo.id} className="shrink-0 space-y-1 text-center">
                <img
                  src={photo.thumbnail_url ?? undefined}
                  alt={photo.filename ?? ''}
                  className="h-24 w-24 rounded border object-cover"
                />
                {single.photos.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => onSplit(photo.id)}
                    title={t('edit.splitHint')}
                  >
                    <Scissors className="mr-1 h-3 w-3" />
                    {t('edit.split')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {select('type', t('fields.type'), types.map((c) => ({ value: c.value, label: c.label })))}
          {select('primary_color', t('fields.color'), colors.map((c) => ({ value: c.value, label: c.name })))}
          {select('pattern', t('fields.pattern'), PATTERN_VALUES.map((v) => ({ value: v, label: patternLabel(v) })))}
          {select('material', t('fields.material'), MATERIAL_VALUES.map((v) => ({ value: v, label: materialLabel(v) })))}
          {select('formality', t('fields.formality'), FORMALITY_VALUES.map((v) => ({ value: v, label: formalityLabel(v) })))}
          <div className="space-y-1">
            <Label htmlFor="garment-brand">{t('fields.brand')}</Label>
            <Input
              id="garment-brand"
              value={form.brand}
              maxLength={100}
              placeholder={single ? '' : t('edit.keep')}
              onChange={(e) => set('brand', e.target.value)}
            />
          </div>
          {single && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="garment-name">{t('fields.name')}</Label>
              <Input
                id="garment-name"
                value={form.name}
                maxLength={100}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('fields.season')}</legend>
          {!single && form.season === null ? (
            <Button size="sm" variant="outline" onClick={() => set('season', [])}>
              {t('edit.setSeasons')}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-3">
              {SEASON_VALUES.map((season) => (
                <label key={season} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.season?.includes(season) ?? false}
                    onCheckedChange={(checked) =>
                      set(
                        'season',
                        checked
                          ? [...(form.season ?? []), season]
                          : (form.season ?? []).filter((s) => s !== season),
                      )
                    }
                  />
                  {seasonLabel(season)}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={onDiscard}>
            <Trash2 className="mr-1 h-4 w-4" />
            {single ? t('edit.discard') : t('edit.discardSelected', { count: garments.length })}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('edit.cancel')}
            </Button>
            <Button disabled={busy || Object.keys(changes).length === 0} onClick={() => onSave(changes)}>
              {t('edit.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
