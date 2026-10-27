// Fork: client for the batch upload review inbox (/upload-batches, BATCH_UPLOAD_ENABLED).
import { API_BASE_PATH, ApiError, api, getAccessToken } from '@/lib/api';

export type BatchStatus = 'uploading' | 'processing' | 'review' | 'closed';
export type PhotoStatus =
  | 'queued'
  | 'prepared'
  | 'tagging'
  | 'ready'
  | 'error'
  | 'confirmed'
  | 'discarded';

export interface GarmentTags {
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  brand?: string | null;
  primary_color?: string | null;
  colors?: string[] | null;
  pattern?: string | null;
  material?: string | null;
  style?: string[] | null;
  season?: string[] | null;
  formality?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

export interface BatchPhoto {
  id: string;
  position: number;
  filename: string | null;
  status: PhotoStatus;
  group_id: string | null;
  is_primary: boolean;
  tags: GarmentTags | null;
  duplicate_of_item_id: string | null;
  duplicate_score: number | null;
  error: string | null;
  thumbnail_url: string | null;
  medium_url: string | null;
}

export interface DuplicateItem {
  id: string;
  type: string;
  name: string | null;
  primary_color: string | null;
  thumbnail_url: string | null;
}

export type BlockedReason =
  | 'still processing'
  | 'still being analyzed'
  | 'possible duplicate to resolve'
  | 'type missing';

export interface Garment {
  group_id: string;
  primary_photo_id: string;
  photos: BatchPhoto[];
  blocked_reason: BlockedReason | null;
  duplicate_item: DuplicateItem | null;
}

export interface BatchSummary {
  id: string;
  status: BatchStatus;
  sealed_at: string | null;
  paused_until: string | null;
  pause_reason: string | null;
  created_at: string;
  total_photos: number;
  counts: Partial<Record<PhotoStatus, number>>;
}

export interface BatchDetail extends BatchSummary {
  groups: Garment[];
  ungrouped: BatchPhoto[];
}

export interface ConfirmResult extends BatchDetail {
  created_item_ids: string[];
  skipped: Record<string, BlockedReason>;
}

export type GarmentChanges = Pick<
  GarmentTags,
  | 'type'
  | 'subtype'
  | 'name'
  | 'brand'
  | 'primary_color'
  | 'colors'
  | 'pattern'
  | 'material'
  | 'style'
  | 'season'
  | 'formality'
>;

interface PhotoUploadResult {
  filename: string;
  success: boolean;
  photo_id: string | null;
  duplicate: boolean;
  error: string | null;
  error_code: string | null;
}

interface PhotoUploadResponse {
  total: number;
  successful: number;
  failed: number;
  results: PhotoUploadResult[];
}

const base = (batchId: string) => `/upload-batches/${batchId}`;

export const batchApi = {
  list: () => api.get<BatchSummary[]>('/upload-batches'),
  create: () => api.post<BatchSummary>('/upload-batches'),
  get: (batchId: string) => api.get<BatchDetail>(base(batchId)),
  seal: (batchId: string) => api.post<BatchSummary>(`${base(batchId)}/seal`),
  remove: (batchId: string) => api.delete<void>(base(batchId)),
  confirm: (batchId: string, groupIds: string[] | null) =>
    api.post<ConfirmResult>(`${base(batchId)}/confirm`, { group_ids: groupIds }),
  update: (batchId: string, groupIds: string[], changes: GarmentChanges) =>
    api.patch<BatchDetail>(`${base(batchId)}/groups`, { group_ids: groupIds, changes }),
  merge: (batchId: string, groupIds: string[]) =>
    api.post<BatchDetail>(`${base(batchId)}/merge`, { group_ids: groupIds }),
  discard: (batchId: string, groupIds: string[]) =>
    api.post<BatchDetail>(`${base(batchId)}/discard`, { group_ids: groupIds }),
  split: (batchId: string, photoId: string) =>
    api.post<BatchDetail>(`${base(batchId)}/photos/${photoId}/split`),
  notDuplicate: (batchId: string, groupId: string) =>
    api.post<BatchDetail>(`${base(batchId)}/groups/${groupId}/not-duplicate`),
  attach: (batchId: string, groupId: string) =>
    api.post<BatchDetail>(`${base(batchId)}/groups/${groupId}/attach`, {}),
  retag: (batchId: string, groupId: string) =>
    api.post<BatchDetail>(`${base(batchId)}/groups/${groupId}/retag`),
};

// Same budget as the upstream bulk upload: well under a proxy's 50 MB body limit.
export const CHUNK_MAX_FILES = 8;
export const CHUNK_MAX_BYTES = 15 * 1024 * 1024;

/** Split files into upload requests by count and size, keeping their order. */
export function chunkFiles<T extends { size: number }>(
  files: readonly T[],
  maxFiles = CHUNK_MAX_FILES,
  maxBytes = CHUNK_MAX_BYTES,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of files) {
    if (current.length > 0 && (current.length >= maxFiles || bytes + file.size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface UploadProgress {
  sent: number;
  total: number;
  failed: { filename: string; error: string }[];
}

const CHUNK_ATTEMPTS = 3;

async function postChunk(batchId: string, files: File[], keys: string[]): Promise<PhotoUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('images', file, file.name));
  keys.forEach((key) => formData.append('upload_keys', key));
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_PATH}${base(batchId)}/photos`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      typeof data.detail === 'string' ? data.detail : 'Upload failed',
      response.status,
      data,
    );
  }
  return response.json();
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Send photos to a batch in order, chunk by chunk. A failed request is resent with the same
 * idempotency keys, so a chunk the server already stored is not stored twice.
 */
export async function uploadPhotos(
  batchId: string,
  files: File[],
  onProgress: (progress: UploadProgress) => void,
  maxFiles = CHUNK_MAX_FILES,
): Promise<UploadProgress> {
  const progress: UploadProgress = { sent: 0, total: files.length, failed: [] };
  onProgress({ ...progress });
  for (const chunk of chunkFiles(files, maxFiles)) {
    const keys = chunk.map(() => newKey());
    let result: PhotoUploadResponse | null = null;
    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS && result === null; attempt++) {
      try {
        result = await postChunk(batchId, chunk, keys);
      } catch (error) {
        // A 4xx (sealed batch, too many photos) fails the same way on every attempt.
        if (error instanceof ApiError && error.status < 500) throw error;
        if (attempt === CHUNK_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    for (const row of result!.results) {
      if (!row.success) progress.failed.push({ filename: row.filename, error: row.error ?? '' });
    }
    progress.sent += chunk.length;
    onProgress({ ...progress, failed: [...progress.failed] });
  }
  return progress;
}

/** Garments the user can confirm right now. */
export function readyGarments(batch: BatchDetail | undefined): Garment[] {
  return batch?.groups.filter((g) => g.blocked_reason === null) ?? [];
}

export function primaryPhoto(garment: Garment): BatchPhoto {
  return garment.photos.find((p) => p.id === garment.primary_photo_id) ?? garment.photos[0];
}

/** Photos still on their way to the inbox: being prepared or analyzed. */
export function workInProgress(batch: BatchSummary | undefined): { preparing: number; analyzing: number } {
  const counts = batch?.counts ?? {};
  return {
    preparing: (counts.queued ?? 0) + (counts.prepared ?? 0),
    analyzing: counts.tagging ?? 0,
  };
}
