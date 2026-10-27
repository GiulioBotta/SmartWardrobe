'use client';

// Fork: review inbox for photos uploaded in a batch (BATCH_UPLOAD_ENABLED).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Combine, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BatchUploader } from '@/components/inbox/batch-uploader';
import { GarmentCard } from '@/components/inbox/garment-card';
import { GarmentEditDialog } from '@/components/inbox/garment-edit-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getErrorMessage } from '@/lib/api';
import {
  batchApi,
  readyGarments,
  workInProgress,
  type BatchSummary,
  type GarmentChanges,
} from '@/lib/batch-inbox';
import {
  batchKeys,
  useBatch,
  useBatchUploadEnabled,
  useInboxAction,
  useOpenBatches,
} from '@/lib/hooks/use-batch-inbox';
import { useFeatures } from '@/lib/hooks/use-features';

type PendingDiscard = { groupIds: string[] } | null;

export default function InboxPage() {
  const t = useTranslations('batchInbox');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { isLoading: featuresLoading } = useFeatures();
  const enabled = useBatchUploadEnabled();
  const { data: openBatches, isLoading: batchesLoading } = useOpenBatches(enabled);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const batchId = chosenId ?? openBatches?.[0]?.id ?? null;
  const { data: batch } = useBatch(batchId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string[] | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard>(null);
  const [abandoning, setAbandoning] = useState(false);

  // Pinned once known, so a batch that closes stays on screen with its "all done" card
  // instead of being swapped for the next open one.
  useEffect(() => {
    if (!chosenId && openBatches?.[0]) setChosenId(openBatches[0].id);
  }, [chosenId, openBatches]);

  const groups = useMemo(() => batch?.groups ?? [], [batch]);
  const ready = readyGarments(batch);
  const { preparing, analyzing } = workInProgress(batch);

  // Drop selections whose garment was confirmed, merged away or discarded.
  useEffect(() => {
    const present = new Set(groups.map((g) => g.group_id));
    setSelected((prev) => {
      const next = new Set(Array.from(prev).filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [groups]);

  const onError = (error: unknown) => toast.error(getErrorMessage(error, t('actions.failed')));

  const confirm = useInboxAction(batchId, (id, groupIds: string[] | null) => batchApi.confirm(id, groupIds), {
    touchesWardrobe: true,
  });
  const update = useInboxAction(batchId, (id, args: { groupIds: string[]; changes: GarmentChanges }) =>
    batchApi.update(id, args.groupIds, args.changes),
  );
  const merge = useInboxAction(batchId, (id, groupIds: string[]) => batchApi.merge(id, groupIds));
  const discard = useInboxAction(batchId, (id, groupIds: string[]) => batchApi.discard(id, groupIds));
  const split = useInboxAction(batchId, (id, photoId: string) => batchApi.split(id, photoId));
  const notDuplicate = useInboxAction(batchId, (id, groupId: string) => batchApi.notDuplicate(id, groupId));
  const attach = useInboxAction(batchId, (id, groupId: string) => batchApi.attach(id, groupId), {
    touchesWardrobe: true,
  });
  const retag = useInboxAction(batchId, (id, groupId: string) => batchApi.retag(id, groupId));
  const busy = [confirm, update, merge, discard, split, notDuplicate, attach, retag].some((m) => m.isPending);

  const runConfirm = (groupIds: string[] | null) =>
    confirm.mutate(groupIds, {
      onSuccess: (result) => {
        const created = result.created_item_ids.length;
        const skipped = Object.keys(result.skipped).length;
        if (created > 0) toast.success(t('actions.confirmed', { count: created }));
        if (skipped > 0) toast.warning(t('actions.skipped', { count: skipped }));
        setSelected(new Set());
      },
      onError,
    });

  const runDiscard = (groupIds: string[]) =>
    discard.mutate(groupIds, {
      onSuccess: () => {
        toast.success(t('actions.discarded', { count: groupIds.length }));
        setPendingDiscard(null);
        setEditing(null);
      },
      onError,
    });

  const runAbandon = async () => {
    if (!batchId) return;
    try {
      await batchApi.remove(batchId);
      toast.success(t('actions.abandoned'));
      // Out of the cached list first: the page falls back to the first open batch and would
      // otherwise read the deleted one again (a 404) before the list refetch lands.
      queryClient.setQueryData<BatchSummary[]>(batchKeys.all, (prev) =>
        prev?.filter((b) => b.id !== batchId),
      );
      queryClient.removeQueries({ queryKey: batchKeys.detail(batchId) });
      setChosenId(null);
      await queryClient.invalidateQueries({ queryKey: batchKeys.all });
    } catch (error) {
      onError(error);
    } finally {
      setAbandoning(false);
    }
  };

  const runSeal = async () => {
    if (!batchId) return;
    try {
      await batchApi.seal(batchId);
      await queryClient.invalidateQueries({ queryKey: batchKeys.all });
    } catch (error) {
      onError(error);
    }
  };

  const editingGarments = editing ? groups.filter((g) => editing.includes(g.group_id)) : [];
  const selectedIds = Array.from(selected);

  if (featuresLoading || (enabled && batchesLoading)) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!enabled) {
    return (
      <Alert>
        <AlertTitle>{t('disabled.title')}</AlertTitle>
        <AlertDescription>{t('disabled.description')}</AlertDescription>
      </Alert>
    );
  }

  const pausedUntil = batch?.paused_until ? new Date(batch.paused_until) : null;
  const uploading = batch?.status === 'uploading';

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <BatchUploader
        openBatchId={uploading ? batchId : null}
        onUploaded={(id) => {
          setChosenId(id);
          queryClient.invalidateQueries({ queryKey: batchKeys.detail(id) });
        }}
      />

      {openBatches && openBatches.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('otherBatches')}</span>
          {openBatches.map((b) => (
            <Button
              key={b.id}
              size="sm"
              variant={b.id === batchId ? 'default' : 'outline'}
              onClick={() => setChosenId(b.id)}
            >
              {new Date(b.created_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
              {' · '}
              {t('photoCount', { count: b.total_photos })}
            </Button>
          ))}
        </div>
      )}

      {batch && uploading && (
        <Alert>
          <AlertTitle>{t('interrupted.title')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t('interrupted.description', { count: batch.total_photos })}
            <Button size="sm" onClick={runSeal}>{t('interrupted.seal')}</Button>
          </AlertDescription>
        </Alert>
      )}

      {pausedUntil && pausedUntil > new Date() && (
        <Alert className="border-amber-500/50">
          <Clock className="h-4 w-4" />
          <AlertTitle>{t('paused.title')}</AlertTitle>
          <AlertDescription>
            {t('paused.description', {
              time: pausedUntil.toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
            })}
          </AlertDescription>
        </Alert>
      )}

      {batch && (preparing > 0 || analyzing > 0) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('working', { preparing, analyzing })}
        </div>
      )}

      {batch?.status === 'closed' && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-6">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <span className="font-medium">{t('done.title')}</span>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/wardrobe">{t('done.toWardrobe')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!batch && !batchId && (
        <p className="text-center text-muted-foreground">{t('empty')}</p>
      )}

      {groups.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {t('summary', { garments: groups.length, ready: ready.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(selected.size === groups.length ? new Set() : new Set(groups.map((g) => g.group_id)))
                }
              >
                {selected.size === groups.length ? t('selectNone') : t('selectAll')}
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setAbandoning(true)}>
                {t('abandon.button')}
              </Button>
              <Button size="sm" disabled={busy || ready.length === 0} onClick={() => runConfirm(null)}>
                {t('confirmAll', { count: ready.length })}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {groups.map((garment) => (
              <GarmentCard
                key={garment.group_id}
                garment={garment}
                busy={busy}
                selected={selected.has(garment.group_id)}
                onSelect={(value) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (value) next.add(garment.group_id);
                    else next.delete(garment.group_id);
                    return next;
                  })
                }
                onEdit={() => setEditing([garment.group_id])}
                onConfirm={() => runConfirm([garment.group_id])}
                onRetag={() => retag.mutate(garment.group_id, { onError })}
                onAttach={() =>
                  attach.mutate(garment.group_id, {
                    onSuccess: () => toast.success(t('actions.attached')),
                    onError,
                  })
                }
                onNotDuplicate={() => notDuplicate.mutate(garment.group_id, { onError })}
              />
            ))}
          </div>
        </>
      )}

      {batch && batch.ungrouped.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('ungrouped', { count: batch.ungrouped.length })}</p>
          <div className="flex flex-wrap gap-2">
            {batch.ungrouped.map((photo) => (
              <img
                key={photo.id}
                src={photo.thumbnail_url ?? undefined}
                alt={photo.filename ?? ''}
                className="h-16 w-16 rounded border object-cover opacity-70"
              />
            ))}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        // Above the mobile bottom navigation (h-16), flush with the bottom next to the sidebar.
        <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-card p-3 shadow-lg lg:bottom-0 lg:left-72">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-medium">{t('toolbar.selected', { count: selected.size })}</span>
            <Button size="sm" disabled={busy} onClick={() => runConfirm(selectedIds)}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {t('toolbar.confirm')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(selectedIds)}>
              <Pencil className="mr-1 h-4 w-4" />
              {t('toolbar.edit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || selected.size < 2}
              title={t('toolbar.mergeHint')}
              onClick={() =>
                merge.mutate(selectedIds, {
                  onSuccess: () => {
                    toast.success(t('actions.merged'));
                    setSelected(new Set());
                  },
                  onError,
                })
              }
            >
              <Combine className="mr-1 h-4 w-4" />
              {t('toolbar.merge')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => setPendingDiscard({ groupIds: selectedIds })}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('toolbar.discard')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={t('toolbar.clear')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <GarmentEditDialog
        open={editing !== null && editingGarments.length > 0}
        onOpenChange={(open) => !open && setEditing(null)}
        garments={editingGarments}
        busy={busy}
        onSave={(changes) =>
          update.mutate(
            { groupIds: editing ?? [], changes },
            {
              onSuccess: () => {
                toast.success(t('actions.saved'));
                setEditing(null);
              },
              onError,
            },
          )
        }
        onSplit={(photoId) =>
          split.mutate(photoId, {
            onSuccess: () => {
              toast.success(t('actions.split'));
              setEditing(null);
            },
            onError,
          })
        }
        onDiscard={() => setPendingDiscard({ groupIds: editing ?? [] })}
      />

      <AlertDialog open={pendingDiscard !== null} onOpenChange={(open) => !open && setPendingDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardConfirm.title', { count: pendingDiscard?.groupIds.length ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('edit.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDiscard && runDiscard(pendingDiscard.groupIds)}>
              {t('discardConfirm.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={abandoning} onOpenChange={setAbandoning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('abandon.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('abandon.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('edit.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={runAbandon}>{t('abandon.action')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
