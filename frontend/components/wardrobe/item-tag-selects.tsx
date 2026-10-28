'use client';

// Fork: pattern, material and formality in the item edit form. The original form only edits
// name, type, subtype, brand and colour, so tags read from a photo could not be corrected.
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PATTERN_VALUES, type EditableTagField, type EditableTags } from '@/lib/garment-tags';
import { FORMALITY_VALUES, MATERIAL_VALUES } from '@/lib/generated/garment-vocabulary';
import {
  useFormalityLabel,
  useMaterialLabel,
  usePatternLabel,
} from '@/lib/hooks/use-translated-constants';

// Select needs a non-empty value for "not set".
const NONE = '__none';

interface ItemTagSelectsProps {
  value: EditableTags;
  onChange: (value: EditableTags) => void;
}

export function ItemTagSelects({ value, onChange }: ItemTagSelectsProps) {
  const t = useTranslations('batchInbox.fields');
  const patternLabel = usePatternLabel();
  const materialLabel = useMaterialLabel();
  const formalityLabel = useFormalityLabel();

  const fields: { field: EditableTagField; options: readonly string[]; label: (v: string) => string }[] = [
    { field: 'material', options: MATERIAL_VALUES, label: materialLabel },
    { field: 'pattern', options: PATTERN_VALUES, label: patternLabel },
    { field: 'formality', options: FORMALITY_VALUES, label: formalityLabel },
  ];

  return (
    <div className="space-y-3">
      {fields.map(({ field, options, label }) => (
        <div key={field} className="space-y-2">
          <Label htmlFor={`item-${field}`}>{t(field)}</Label>
          <Select
            value={value[field] || NONE}
            onValueChange={(v) => onChange({ ...value, [field]: v === NONE ? '' : v })}
          >
            <SelectTrigger id={`item-${field}`} aria-label={t(field)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {label(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
