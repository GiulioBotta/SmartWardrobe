'use client';

// Fork: React Query hooks for the batch upload review inbox.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { batchApi, type BatchDetail } from '@/lib/batch-inbox';
import { queryKeys } from '@/lib/hooks/query-keys';
import { useFeatures } from '@/lib/hooks/use-features';
import { applySessionToken } from '@/lib/hooks/use-session-token';

// Own prefix, outside ['items'] (see the invariant in query-keys.ts).
export const batchKeys = {
  all: ['upload-batches'] as const,
  detail: (batchId: string) => ['upload-batches', batchId] as const,
};

// How often a batch with photos still being prepared or analyzed is read again.
const PROCESSING_REFETCH_MS = 5000;

export function useBatchUploadEnabled(): boolean {
  return useFeatures().data?.batch_upload === true;
}

export function useOpenBatches(enabled = true) {
  const { data: session, status } = useSession();
  applySessionToken(session);
  return useQuery({
    queryKey: batchKeys.all,
    queryFn: batchApi.list,
    enabled: enabled && status !== 'loading',
  });
}

export function useBatch(batchId: string | null) {
  const { data: session, status } = useSession();
  applySessionToken(session);
  return useQuery({
    queryKey: batchKeys.detail(batchId ?? 'none'),
    queryFn: () => batchApi.get(batchId!),
    enabled: !!batchId && status !== 'loading',
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? PROCESSING_REFETCH_MS : false,
  });
}

/**
 * Every inbox action answers with the batch as it now is, which replaces the cached detail.
 * Confirming or attaching changes the wardrobe, so its item lists are refreshed too.
 */
export function useInboxAction<TArgs, TResult extends BatchDetail>(
  batchId: string | null,
  action: (batchId: string, args: TArgs) => Promise<TResult>,
  { touchesWardrobe = false } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(batchId!, args),
    onSuccess: (detail) => {
      queryClient.setQueryData(batchKeys.detail(detail.id), detail);
      queryClient.invalidateQueries({ queryKey: batchKeys.all, exact: true });
      if (touchesWardrobe) {
        queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.everyItem });
      }
    },
  });
}

/** The sidebar entry, or null while the feature is off. */
export function useInboxNavItem() {
  const t = useTranslations('batchInbox');
  if (!useBatchUploadEnabled()) return null;
  return { name: t('nav'), href: '/dashboard/inbox', icon: Inbox };
}
