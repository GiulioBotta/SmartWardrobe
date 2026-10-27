// Filters for the fork's suggestion pipeline (backend OutfitFilters, SUGGESTION_COMBOS_ENABLED).

export interface OutfitFilters {
  colors: string[];
  exclude_colors: string[];
  formality: string[];
  exclude_types: string[];
  favorites_only: boolean;
  not_worn_in_days: number | null;
}

export const EMPTY_FILTERS: OutfitFilters = {
  colors: [],
  exclude_colors: [],
  formality: [],
  exclude_types: [],
  favorites_only: false,
  not_worn_in_days: null,
};

export const MAX_PINNED_ITEMS = 4;

export function countActiveFilters(filters: OutfitFilters): number {
  return (
    filters.colors.length +
    filters.exclude_colors.length +
    filters.formality.length +
    filters.exclude_types.length +
    (filters.favorites_only ? 1 : 0) +
    (filters.not_worn_in_days ? 1 : 0)
  );
}

// Only the fields that narrow anything, so an untouched panel sends no filters at all and the
// backend can keep serving cached suggestions.
export function toRequestFilters(filters: OutfitFilters): Partial<OutfitFilters> | undefined {
  if (countActiveFilters(filters) === 0) return undefined;
  const out: Partial<OutfitFilters> = {};
  if (filters.colors.length) out.colors = filters.colors;
  if (filters.exclude_colors.length) out.exclude_colors = filters.exclude_colors;
  if (filters.formality.length) out.formality = filters.formality;
  if (filters.exclude_types.length) out.exclude_types = filters.exclude_types;
  if (filters.favorites_only) out.favorites_only = true;
  if (filters.not_worn_in_days) out.not_worn_in_days = filters.not_worn_in_days;
  return out;
}

export type ColorChoice = 'none' | 'keep' | 'avoid';

export function colorChoice(filters: OutfitFilters, color: string): ColorChoice {
  if (filters.colors.includes(color)) return 'keep';
  if (filters.exclude_colors.includes(color)) return 'avoid';
  return 'none';
}

// One tap keeps a colour, a second avoids it, a third clears it.
export function cycleColor(filters: OutfitFilters, color: string): OutfitFilters {
  const choice = colorChoice(filters, color);
  const colors = filters.colors.filter((c) => c !== color);
  const exclude = filters.exclude_colors.filter((c) => c !== color);
  if (choice === 'none') return { ...filters, colors: [...colors, color], exclude_colors: exclude };
  if (choice === 'keep') return { ...filters, colors, exclude_colors: [...exclude, color] };
  return { ...filters, colors, exclude_colors: exclude };
}

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
