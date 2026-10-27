'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Ban, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CLOTHING_COLORS, FORMALITY_VALUES } from '@/lib/generated/garment-vocabulary';
import {
  useColorLabel,
  useFormalityLabel,
  useTypeLabel,
} from '@/lib/hooks/use-translated-constants';
import {
  EMPTY_FILTERS,
  OutfitFilters,
  colorChoice,
  countActiveFilters,
  cycleColor,
  toggleValue,
} from '@/lib/suggest-filters';
import { cn } from '@/lib/utils';

// Types worth skipping on a given day; the rest of the vocabulary rarely needs it.
const SKIPPABLE_TYPES = [
  'shorts', 'jeans', 'skirt', 'dress', 'hoodie', 'jacket', 'coat', 'blazer', 'sneakers', 'boots', 'sandals',
] as const;
const NOT_WORN_DAYS = [3, 7, 14, 30] as const;

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'px-2.5 py-1 rounded-full border text-xs transition-all',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-muted bg-background hover:border-primary/50'
      )}
    >
      {children}
    </button>
  );
}

export function OutfitFilterPanel({
  filters,
  onChange,
  hasPinned,
}: {
  filters: OutfitFilters;
  onChange: (filters: OutfitFilters) => void;
  hasPinned: boolean;
}) {
  const t = useTranslations('smartSuggest.filters');
  const colorLabel = useColorLabel();
  const formalityLabel = useFormalityLabel();
  const typeLabel = useTypeLabel();
  const [isOpen, setIsOpen] = useState(false);
  const active = countActiveFilters(filters);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="filters-toggle"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
          <span>{t('title')}</span>
          {active > 0 && (
            <Badge variant="secondary" className="text-xs">
              {t('active', { count: active })}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="space-y-5 p-4 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {hasPinned ? t('pinnedFormality') : t('intro')}
            </p>
            {active > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
                {t('reset')}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">{t('palette')}</span>
              <p className="text-xs text-muted-foreground">{t('paletteHint')}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CLOTHING_COLORS.map((c) => {
                const choice = colorChoice(filters, c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => onChange(cycleColor(filters, c.value))}
                    data-testid={`filter-color-${c.value}`}
                    data-choice={choice}
                    title={colorLabel(c.value)}
                    className={cn(
                      'flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs transition-all',
                      choice === 'keep' && 'border-primary bg-primary/10 text-primary',
                      choice === 'avoid' && 'border-destructive/60 bg-destructive/10 text-destructive line-through',
                      choice === 'none' && 'border-muted bg-background hover:border-primary/50'
                    )}
                  >
                    <span
                      className="h-4 w-4 rounded-full border flex items-center justify-center"
                      style={{ backgroundColor: c.hex }}
                    >
                      {choice === 'keep' && <Check className="h-2.5 w-2.5 text-white mix-blend-difference" />}
                      {choice === 'avoid' && <Ban className="h-2.5 w-2.5 text-white mix-blend-difference" />}
                    </span>
                    {colorLabel(c.value)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t('formality')}</span>
            <div className="flex flex-wrap gap-1.5">
              {FORMALITY_VALUES.map((value) => (
                <Chip
                  key={value}
                  active={filters.formality.includes(value)}
                  onClick={() => onChange({ ...filters, formality: toggleValue(filters.formality, value) })}
                  testId={`filter-formality-${value}`}
                >
                  {formalityLabel(value)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t('skipTypes')}</span>
            <div className="flex flex-wrap gap-1.5">
              {SKIPPABLE_TYPES.map((value) => (
                <Chip
                  key={value}
                  active={filters.exclude_types.includes(value)}
                  onClick={() =>
                    onChange({ ...filters, exclude_types: toggleValue(filters.exclude_types, value) })
                  }
                  testId={`filter-skip-${value}`}
                >
                  {typeLabel(value)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={filters.favorites_only}
                onCheckedChange={(checked) => onChange({ ...filters, favorites_only: checked })}
                data-testid="filter-favorites"
              />
              {t('favoritesOnly')}
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">{t('notWorn')}</span>
              <Chip
                active={!filters.not_worn_in_days}
                onClick={() => onChange({ ...filters, not_worn_in_days: null })}
              >
                {t('notWornAny')}
              </Chip>
              {NOT_WORN_DAYS.map((days) => (
                <Chip
                  key={days}
                  active={filters.not_worn_in_days === days}
                  onClick={() => onChange({ ...filters, not_worn_in_days: days })}
                  testId={`filter-not-worn-${days}`}
                >
                  {t('notWornDays', { days })}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
