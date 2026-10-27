import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inShootingOrder } from '@/components/inbox/batch-uploader'
import { GarmentCard } from '@/components/inbox/garment-card'
import { changedFields } from '@/components/inbox/garment-edit-dialog'
import {
  chunkFiles,
  readyGarments,
  uploadPhotos,
  workInProgress,
  type BatchDetail,
  type BatchPhoto,
  type Garment,
} from '@/lib/batch-inbox'

const MB = 1024 * 1024

function photo(overrides: Partial<BatchPhoto> = {}): BatchPhoto {
  return {
    id: 'p1',
    position: 0,
    filename: 'front.jpg',
    status: 'ready',
    group_id: 'g1',
    is_primary: true,
    tags: { type: 'shirt', primary_color: 'white' },
    duplicate_of_item_id: null,
    duplicate_score: null,
    error: null,
    thumbnail_url: '/t.jpg',
    medium_url: '/m.jpg',
    ...overrides,
  }
}

function garment(overrides: Partial<Garment> = {}): Garment {
  return {
    group_id: 'g1',
    primary_photo_id: 'p1',
    photos: [photo()],
    blocked_reason: null,
    duplicate_item: null,
    ...overrides,
  }
}

describe('chunkFiles', () => {
  it('splits by count and by size, keeping order', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, size: 1 * MB }))
    expect(chunkFiles(files, 8).map((c) => c.length)).toEqual([8, 2])
    const big = [{ size: 9 * MB }, { size: 9 * MB }, { size: 1 * MB }]
    expect(chunkFiles(big, 8, 15 * MB).map((c) => c.map((f) => f.size / MB))).toEqual([[9], [9, 1]])
  })

  it('sends a file larger than the budget on its own instead of dropping it', () => {
    expect(chunkFiles([{ size: 20 * MB }], 8, 15 * MB)).toEqual([[{ size: 20 * MB }]])
    expect(chunkFiles([])).toEqual([])
  })
})

describe('uploadPhotos', () => {
  const ok = (count: number) =>
    new Response(
      JSON.stringify({
        total: count,
        successful: count,
        failed: 0,
        results: Array.from({ length: count }, (_, i) => ({ filename: `f${i}`, success: true })),
      }),
      { status: 201 },
    )

  beforeEach(() => vi.mocked(global.fetch).mockReset())

  it('resends a failed chunk with the same idempotency keys', async () => {
    vi.useFakeTimers()
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(ok(2))
    const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')]
    const onProgress = vi.fn()
    const done = uploadPhotos('batch-1', files, onProgress)
    await vi.runAllTimersAsync()
    const result = await done
    vi.useRealTimers()

    const calls = vi.mocked(global.fetch).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('/api/v1/upload-batches/batch-1/photos')
    const keys = (call: (typeof calls)[number]) => (call[1]!.body as FormData).getAll('upload_keys')
    expect(keys(calls[0])).toHaveLength(2)
    expect(keys(calls[1])).toEqual(keys(calls[0]))
    expect(result).toEqual({ sent: 2, total: 2, failed: [] })
    expect(onProgress).toHaveBeenLastCalledWith({ sent: 2, total: 2, failed: [] })
  })

  it('does not retry a request the server refused', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Batch already sealed' }), { status: 409 }),
    )
    await expect(uploadPhotos('b', [new File(['a'], 'a.jpg')], vi.fn())).rejects.toThrow(
      'Batch already sealed',
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports the files the server did not accept', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 1,
          successful: 0,
          failed: 1,
          results: [{ filename: 'x.txt', success: false, error: 'Invalid image format' }],
        }),
        { status: 201 },
      ),
    )
    const result = await uploadPhotos('b', [new File(['x'], 'x.txt')], vi.fn())
    expect(result.failed).toEqual([{ filename: 'x.txt', error: 'Invalid image format' }])
  })
})

describe('batch helpers', () => {
  it('counts only garments without a blocker as ready, and work still in flight', () => {
    const batch = {
      counts: { queued: 1, prepared: 2, tagging: 3, ready: 4 },
      groups: [garment(), garment({ group_id: 'g2', blocked_reason: 'type missing' })],
    } as unknown as BatchDetail
    expect(readyGarments(batch).map((g) => g.group_id)).toEqual(['g1'])
    expect(workInProgress(batch)).toEqual({ preparing: 3, analyzing: 3 })
    expect(readyGarments(undefined)).toEqual([])
  })

  it('orders photos by when they were taken', () => {
    const later = new File([''], 'IMG_2.jpg', { lastModified: 2000 })
    const earlier = new File([''], 'IMG_9.jpg', { lastModified: 1000 })
    expect(inShootingOrder([later, earlier]).map((f) => f.name)).toEqual(['IMG_9.jpg', 'IMG_2.jpg'])
  })
})

describe('changedFields', () => {
  const start = {
    type: 'shirt',
    primary_color: '__keep',
    pattern: '__keep',
    material: '__keep',
    formality: '__keep',
    name: '',
    brand: 'Uniqlo',
    season: ['summer'],
  }

  it('sends only what the user changed', () => {
    expect(changedFields(start, start)).toEqual({})
    expect(
      changedFields(start, { ...start, type: 'polo', brand: ' ', season: ['summer', 'spring'] }),
    ).toEqual({ type: 'polo', brand: null, season: ['summer', 'spring'] })
  })

  it('leaves seasons alone in a bulk edit until the user sets them', () => {
    const bulk = { ...start, season: null }
    expect(changedFields(bulk, { ...bulk, material: 'wool' })).toEqual({ material: 'wool' })
  })
})

describe('GarmentCard', () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onConfirm: vi.fn(),
    onRetag: vi.fn(),
    onAttach: vi.fn(),
    onNotDuplicate: vi.fn(),
  })

  it('confirms a ready garment', () => {
    const on = handlers()
    render(<GarmentCard garment={garment()} selected={false} busy={false} {...on} />)
    fireEvent.click(screen.getByText('card.confirm'))
    expect(on.onConfirm).toHaveBeenCalled()
  })

  it('offers both ways out of a possible duplicate and blocks confirming', () => {
    const on = handlers()
    render(
      <GarmentCard
        garment={garment({
          blocked_reason: 'possible duplicate to resolve',
          duplicate_item: { id: 'i1', type: 'jeans', name: 'Jeans blu', primary_color: 'blue', thumbnail_url: null },
        })}
        selected={false}
        busy={false}
        {...on}
      />,
    )
    expect(screen.getByText('card.confirm').closest('button')).toBeDisabled()
    fireEvent.click(screen.getByText('card.attach'))
    fireEvent.click(screen.getByText('card.notDuplicate'))
    expect(on.onAttach).toHaveBeenCalled()
    expect(on.onNotDuplicate).toHaveBeenCalled()
  })

  it('offers a retry when the analysis failed', () => {
    const on = handlers()
    render(
      <GarmentCard
        garment={garment({ photos: [photo({ status: 'error', error: 'timeout', tags: null })] })}
        selected={false}
        busy={false}
        {...on}
      />,
    )
    expect(screen.getByText('timeout')).toBeInTheDocument()
    fireEvent.click(screen.getByText('card.retry'))
    expect(on.onRetag).toHaveBeenCalled()
  })
})
