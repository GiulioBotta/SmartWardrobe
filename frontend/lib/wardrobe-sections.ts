// Fork: the grouped wardrobe (WARDROBE_SECTIONS_ENABLED). The backend stores the user's choices
// (order, optional categories switched on, collections); which category an item belongs to comes
// from its type, through the generated copy of backend/app/data/wardrobe_sections.json.
import { ApiError, api } from '@/lib/api';
import { SECTION_FALLBACK, SECTION_TYPES } from '@/lib/generated/wardrobe-sections';
import type { Item } from '@/lib/types';

export const UNSORTED_GROUP_ID = 'unsorted';

export interface Section {
  id: string;
  kind: 'category' | 'collection';
  key: string | null;
  name: string | null;
  position: number;
  enabled: boolean;
  item_ids: string[];
}

export interface ItemGroup {
  id: string;
  kind: 'category' | 'collection' | 'unsorted';
  key: string | null;
  name: string | null;
  items: Item[];
}

const SECTION_OF_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_TYPES).flatMap(([key, types]) => types.map((type) => [type, key])),
);

function categoryFor(type: string, enabledKeys: Set<string>): string | null {
  const key = SECTION_OF_TYPE[type];
  if (!key) return null;
  if (key in SECTION_FALLBACK && !enabledKeys.has(key)) {
    const fallback = SECTION_FALLBACK[key];
    return fallback === UNSORTED_GROUP_ID ? null : fallback;
  }
  return key;
}

export function isVisibleSection(section: Section): boolean {
  return section.kind === 'collection' || section.enabled;
}

export function groupItems(items: Item[], sections: Section[]): ItemGroup[] {
  const visible = sections.filter(isVisibleSection).sort((a, b) => a.position - b.position);
  const enabledKeys = new Set(visible.flatMap((s) => (s.kind === 'category' && s.key ? [s.key] : [])));
  const byId = new Map(items.map((item) => [item.id, item]));

  const byCategory = new Map<string, Item[]>();
  const unsorted: Item[] = [];
  for (const item of items) {
    const key = categoryFor(item.type, enabledKeys);
    if (key === null) unsorted.push(item);
    else byCategory.set(key, [...(byCategory.get(key) ?? []), item]);
  }

  const groups: ItemGroup[] = visible.map((section) => {
    const groupItems =
      section.kind === 'collection'
        ? items.filter((item) => section.item_ids.includes(item.id) && byId.has(item.id))
        : byCategory.get(section.key ?? '') ?? [];
    return { id: section.id, kind: section.kind, key: section.key, name: section.name, items: groupItems };
  });
  groups.push({ id: UNSORTED_GROUP_ID, kind: 'unsorted', key: null, name: null, items: unsorted });
  return groups.filter((group) => group.items.length > 0);
}

interface SelectionLike {
  mode: 'none' | 'some' | 'all';
  selectedIds: Set<string>;
  excludedIds: Set<string>;
}

// The item ids a collection action applies to. "All matching" needs every matching item
// loaded, which only the grouped view does; in the paged grid it returns null and the
// collection actions stay hidden rather than act on one page.
export function collectionSelectionIds(
  selection: SelectionLike,
  loadedItems: Item[],
  allLoaded: boolean,
): string[] | null {
  if (selection.mode !== 'all') return Array.from(selection.selectedIds);
  if (!allLoaded) return null;
  return loadedItems.filter((item) => !selection.excludedIds.has(item.id)).map((item) => item.id);
}

const ERROR_CODES = new Set([
  'name_required',
  'name_too_long',
  'name_taken',
  'bad_order',
  'not_collection',
  'not_optional',
]);

// The translation key (in wardrobeSections) for a refusal the server explained with a code,
// so the user reads it in their language; null for anything else.
export function sectionErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const detail = (error.data as { detail?: { code?: unknown } } | null)?.detail;
  const code = typeof detail?.code === 'string' ? detail.code : null;
  return code && ERROR_CODES.has(code) ? `errors.${code}` : null;
}

const BASE = '/wardrobe-sections';

export const sectionsApi = {
  list: () => api.get<{ sections: Section[] }>(BASE).then((r) => r.sections),
  hiddenCounts: () => api.get<Record<string, number>>(`${BASE}/hidden-counts`),
  reorder: (ids: string[]) =>
    api.post<{ sections: Section[] }>(`${BASE}/order`, { ids }).then((r) => r.sections),
  update: (id: string, data: { enabled?: boolean; name?: string }) =>
    api.patch<{ sections: Section[] }>(`${BASE}/${id}`, data).then((r) => r.sections),
  resetOrder: () =>
    api.post<{ sections: Section[] }>(`${BASE}/reset-order`).then((r) => r.sections),
  createCollection: (name: string, itemIds: string[]) =>
    api.post<Section>(`${BASE}/collections`, { name, item_ids: itemIds }),
  deleteCollection: (id: string) => api.delete<void>(`${BASE}/collections/${id}`),
  addItems: (id: string, itemIds: string[]) =>
    api.post<void>(`${BASE}/collections/${id}/items`, { item_ids: itemIds }),
  removeItems: (id: string, itemIds: string[]) =>
    api.post<void>(`${BASE}/collections/${id}/items/remove`, { item_ids: itemIds }),
};
