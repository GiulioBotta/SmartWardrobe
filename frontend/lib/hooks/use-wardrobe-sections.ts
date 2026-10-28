'use client';

// Fork: React Query hooks for the grouped wardrobe (WARDROBE_SECTIONS_ENABLED).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useFeatures } from '@/lib/hooks/use-features';
import { useItemPages } from '@/lib/hooks/use-items';
import { applySessionToken } from '@/lib/hooks/use-session-token';
import type { ItemFilter } from '@/lib/types';
import { sectionsApi, type Section } from '@/lib/wardrobe-sections';

// Own prefix, outside ['items'] (see the invariant in query-keys.ts).
export const sectionKeys = {
  all: ['wardrobe-sections'] as const,
  hiddenCounts: ['wardrobe-sections', 'hidden-counts'] as const,
};

const ALL_ITEMS_PAGE_SIZE = 100;

export function useWardrobeSectionsEnabled(): boolean {
  return useFeatures().data?.wardrobe_sections === true;
}

export function useWardrobeSections(enabled = true) {
  const { data: session, status } = useSession();
  applySessionToken(session);
  return useQuery({
    queryKey: sectionKeys.all,
    queryFn: sectionsApi.list,
    enabled: enabled && status !== 'loading',
  });
}

export function useHiddenCounts(enabled = true) {
  const { data: session, status } = useSession();
  applySessionToken(session);
  return useQuery({
    queryKey: sectionKeys.hiddenCounts,
    queryFn: sectionsApi.hiddenCounts,
    enabled: enabled && status !== 'loading',
  });
}

function useSectionsMutation<V>(mutationFn: (vars: V) => Promise<Section[] | unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (Array.isArray(data)) queryClient.setQueryData(sectionKeys.all, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sectionKeys.all }),
  });
}

export function useReorderSections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => sectionsApi.reorder(ids),
    // Moves show at once; a refused order puts the previous one back.
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: sectionKeys.all });
      const previous = queryClient.getQueryData<Section[]>(sectionKeys.all);
      if (previous) {
        const rank = new Map(ids.map((id, index) => [id, index]));
        queryClient.setQueryData<Section[]>(
          sectionKeys.all,
          previous.map((s) => ({ ...s, position: rank.get(s.id) ?? s.position })),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(sectionKeys.all, context.previous);
    },
    onSuccess: (sections) => queryClient.setQueryData(sectionKeys.all, sections),
  });
}

export function useUpdateSection() {
  return useSectionsMutation(({ id, data }: { id: string; data: { enabled?: boolean; name?: string } }) =>
    sectionsApi.update(id, data),
  );
}

export function useResetSectionOrder() {
  return useSectionsMutation(() => sectionsApi.resetOrder());
}

export function useCreateCollection() {
  return useSectionsMutation(({ name, itemIds }: { name: string; itemIds: string[] }) =>
    sectionsApi.createCollection(name, itemIds),
  );
}

export function useDeleteCollection() {
  return useSectionsMutation((id: string) => sectionsApi.deleteCollection(id));
}

export function useCollectionItems() {
  return useSectionsMutation(
    ({ id, itemIds, remove = false }: { id: string; itemIds: string[]; remove?: boolean }) =>
      remove ? sectionsApi.removeItems(id, itemIds) : sectionsApi.addItems(id, itemIds),
  );
}

// Every item matching the filters, read 100 at a time: groups must not split across pages.
export function useAllItems(filters: ItemFilter, enabled = true) {
  const filterKey = JSON.stringify(filters);
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [filterKey]);
  const result = useItemPages(filters, enabled ? pages : 0, ALL_ITEMS_PAGE_SIZE);
  // Next page only once every requested page has loaded and none failed: has_more comes from
  // the last loaded page, so going on after a failure would skip that page's items.
  const settled = !result.isFetching && !result.isError && result.loadedPages >= pages;
  useEffect(() => {
    if (enabled && result.hasMore && settled) setPages((p) => p + 1);
  }, [enabled, result.hasMore, settled]);
  return result;
}
