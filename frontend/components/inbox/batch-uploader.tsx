'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getErrorMessage } from '@/lib/api';
import { batchApi, CHUNK_MAX_FILES, uploadPhotos, type UploadProgress } from '@/lib/batch-inbox';
import { ACCEPTED_IMAGE_TYPES } from '@/lib/image-types';
import { batchKeys } from '@/lib/hooks/use-batch-inbox';
import { useFeatures } from '@/lib/hooks/use-features';
import { cn } from '@/lib/utils';

interface BatchUploaderProps {
  // A batch whose upload was interrupted; new photos go there instead of a new batch.
  openBatchId: string | null;
  onUploaded: (batchId: string) => void;
}

/** Grouping relies on shooting order, which file pickers do not always keep. */
export function inShootingOrder(files: File[]): File[] {
  return [...files].sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
}

export function BatchUploader({ openBatchId, onUploaded }: BatchUploaderProps) {
  const t = useTranslations('batchInbox');
  const queryClient = useQueryClient();
  const { data: features } = useFeatures();
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const upload = useCallback(
    async (dropped: File[]) => {
      if (dropped.length === 0 || progress) return;
      const files = inShootingOrder(dropped);
      setProgress({ sent: 0, total: files.length, failed: [] });
      let batchId = openBatchId;
      try {
        batchId ??= (await batchApi.create()).id;
        const limit = Math.min(CHUNK_MAX_FILES, features?.max_bulk_upload_count ?? CHUNK_MAX_FILES);
        const result = await uploadPhotos(batchId, files, setProgress, limit);
        await batchApi.seal(batchId);
        const stored = result.total - result.failed.length;
        if (result.failed.length > 0) {
          toast.warning(t('upload.partial', { stored, failed: result.failed.length }), {
            description: result.failed.map((f) => `${f.filename}: ${f.error}`).join('\n'),
          });
        } else {
          toast.success(t('upload.done', { count: stored }));
        }
        onUploaded(batchId);
      } catch (error) {
        toast.error(getErrorMessage(error, t('upload.failed')));
        if (batchId) onUploaded(batchId);
      } finally {
        setProgress(null);
        queryClient.invalidateQueries({ queryKey: batchKeys.all });
      }
    },
    [features, onUploaded, openBatchId, progress, queryClient, t],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: upload,
    accept: ACCEPTED_IMAGE_TYPES,
    multiple: true,
    disabled: progress !== null,
  });

  return (
    <Card>
      <CardContent className="p-4">
        {progress ? (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('upload.progress', { sent: progress.sent, total: progress.total })}
            </div>
            <Progress value={(progress.sent / Math.max(progress.total, 1)) * 100} />
          </div>
        ) : (
          <div
            {...getRootProps()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
              isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
            )}
          >
            <input {...getInputProps()} data-testid="batch-upload-input" />
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">
              {openBatchId ? t('upload.addToOpen') : t('upload.drop')}
            </p>
            <p className="text-sm text-muted-foreground">{t('upload.hint')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
