// Fork: quick wear log ("what I'm wearing today"), on top of the upstream outfit endpoints:
// accept + feedback(worn) for a suggestion, and the Studio's mark_worn for anything else.
import { api } from '@/lib/api';
import { ITEM_ROLE } from '@/lib/generated/garment-vocabulary';
import type { Item, Outfit } from '@/lib/types';

export type Slot = 'tops' | 'bottoms' | 'outerwear' | 'shoes' | 'accessories';

export const SLOT_ORDER: readonly Slot[] = ['tops', 'bottoms', 'outerwear', 'shoes', 'accessories'];

const ROLE_SLOT: Record<string, Slot> = {
  base_top: 'tops',
  mid_layer: 'tops',
  full_body: 'tops',
  suit: 'tops',
  bottom: 'bottoms',
  legwear: 'bottoms',
  outer_layer: 'outerwear',
  footwear: 'shoes',
  socks: 'shoes',
  neckwear: 'accessories',
  accessory: 'accessories',
};

export function slotOf(type: string): Slot {
  return ROLE_SLOT[ITEM_ROLE[type] ?? ''] ?? 'accessories';
}

/** Items by slot, the most recently worn first, so everyday pieces are at hand. */
export function groupBySlot(items: readonly Item[]): Record<Slot, Item[]> {
  const groups = Object.fromEntries(SLOT_ORDER.map((slot) => [slot, [] as Item[]])) as Record<
    Slot,
    Item[]
  >;
  for (const item of items) {
    if (item.status !== 'ready' || item.is_archived) continue;
    groups[slotOf(item.type)].push(item);
  }
  for (const slot of SLOT_ORDER) {
    groups[slot].sort(
      (a, b) =>
        (b.last_worn_at ?? '').localeCompare(a.last_worn_at ?? '') ||
        (b.wear_count ?? 0) - (a.wear_count ?? 0),
    );
  }
  return groups;
}

export function wornOn(outfit: Outfit): string | null {
  if (outfit.feedback?.actually_worn === false) return null;
  return outfit.feedback?.worn_at ?? null;
}

const itemKey = (outfit: Outfit) =>
  outfit.items
    .map((i) => i.id)
    .sort()
    .join(',');

/**
 * Outfits worn before today, newest first, one per set of items: wearing the same look twice
 * leaves two outfits behind, and the list should offer it once.
 */
export function outfitsToRepeat(outfits: readonly Outfit[], today: string, limit = 10): Outfit[] {
  const seen = new Set<string>();
  const out: Outfit[] = [];
  const worn = outfits
    .filter((o) => {
      const day = wornOn(o);
      return day !== null && day < today && o.items.length > 0;
    })
    .sort((a, b) => wornOn(b)!.localeCompare(wornOn(a)!));
  for (const outfit of worn) {
    const key = itemKey(outfit);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(outfit);
    if (out.length === limit) break;
  }
  return out;
}

export function wornToday(outfits: readonly Outfit[], today: string): Outfit[] {
  return outfits.filter((o) => wornOn(o) === today);
}

export function daysAgo(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** A suggestion chosen and worn in one tap. */
export async function wearSuggestionToday(outfitId: string): Promise<void> {
  await api.post(`/outfits/${outfitId}/accept`);
  await api.post(`/outfits/${outfitId}/feedback`, {
    accepted: true,
    worn: true,
    actually_worn: true,
  });
}

/** Items picked by hand, or a past look worn again, logged as worn today. */
export function logWornToday(itemIds: string[], occasion: string, today: string): Promise<Outfit> {
  return api.post<Outfit>('/outfits/studio', {
    items: itemIds,
    occasion,
    scheduled_for: today,
    mark_worn: true,
  });
}

const UNANSWERED = new Set(['pending', 'sent', 'viewed']);

/**
 * The outfit the daily notification proposed for today, while it is still unanswered. Looks the
 * user generated on the suggestion page are left out: those are answered there.
 */
export function pendingForToday(outfits: readonly Outfit[], today: string): Outfit | null {
  return (
    outfits.find(
      (o) =>
        o.source === 'scheduled' &&
        o.scheduled_for === today &&
        UNANSWERED.has(o.status) &&
        !o.feedback?.worn_at,
    ) ?? null
  );
}

/** Set a proposed look aside. Skip, not reject: rejecting keeps its pieces out of later suggestions. */
export async function skipSuggestion(outfitId: string): Promise<void> {
  await api.post(`/outfits/${outfitId}/skip`);
}
