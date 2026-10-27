'use client';

// Fork: a nudge on the home while uploaded photos wait in "Da rivedere".
import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBatchUploadEnabled, useOpenBatches } from '@/lib/hooks/use-batch-inbox';

export function InboxReminder() {
  const t = useTranslations('wearly.today');
  const enabled = useBatchUploadEnabled();
  const { data: batches } = useOpenBatches(enabled);
  if (!enabled || !batches) return null;
  // Photos, not garments: a batch summary counts photos, and grouping is shown on the inbox page.
  const waiting = batches.reduce(
    (n, b) => n + (b.counts.ready ?? 0) + (b.counts.error ?? 0) + (b.counts.tagging ?? 0) + (b.counts.queued ?? 0) + (b.counts.prepared ?? 0),
    0,
  );
  if (waiting === 0) return null;
  return (
    <Link
      href="/dashboard/inbox"
      className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-secondary/60"
    >
      <Inbox className="h-5 w-5 text-brand" aria-hidden="true" />
      <span className="flex-1 text-sm">{t('inboxReminder', { count: waiting })}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
