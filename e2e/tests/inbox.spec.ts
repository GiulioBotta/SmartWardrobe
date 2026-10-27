import { expect, test, type Page, type Route } from '@playwright/test';

// The batch upload inbox: upload, review (edit, resolve a possible duplicate), confirm.
// Login and the page are real; /upload-batches is answered here by a small stateful fake, so
// the test spends no AI quota and never touches the wardrobe. The backend's own actions are
// covered by backend/tests/test_upload_batches.py.

const EMAIL = process.env.E2E_EMAIL ?? 'giulio@wardrobe.test';
const BATCH = '00000000-0000-4000-8000-0000000000b1';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('dev@example.com').fill(EMAIL);
  await page.getByRole('button', { name: /^(accedi|sign in)$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

type Tags = Record<string, unknown> | null;

interface FakeGarment {
  group_id: string;
  photos: number;
  tags: Tags;
  duplicate: boolean;
}

// 1x1 PNG, so every thumbnail loads.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

class FakeInbox {
  status: 'none' | 'uploading' | 'review' | 'closed' = 'none';
  photos = 0;
  garments: FakeGarment[] = [];
  requests: { url: string; body: unknown }[] = [];

  summary() {
    return {
      id: BATCH,
      status: this.status,
      sealed_at: this.status === 'uploading' ? null : new Date().toISOString(),
      paused_until: null,
      pause_reason: null,
      created_at: new Date().toISOString(),
      total_photos: this.photos,
      counts: { ready: this.garments.reduce((n, g) => n + g.photos, 0) },
    };
  }

  detail() {
    return {
      ...this.summary(),
      ungrouped: [],
      groups: this.garments.map((g) => ({
        group_id: g.group_id,
        primary_photo_id: `${g.group_id}-p0`,
        blocked_reason: g.duplicate
          ? 'possible duplicate to resolve'
          : g.tags?.type
            ? null
            : 'type missing',
        duplicate_item: g.duplicate
          ? { id: 'item-1', type: 'jeans', name: 'Jeans blu', primary_color: 'blue', thumbnail_url: PIXEL }
          : null,
        photos: Array.from({ length: g.photos }, (_, i) => ({
          id: `${g.group_id}-p${i}`,
          position: i,
          filename: `${g.group_id}-${i}.jpg`,
          status: 'ready',
          group_id: g.group_id,
          is_primary: i === 0,
          tags: i === 0 ? g.tags : null,
          duplicate_of_item_id: i === 0 && g.duplicate ? 'item-1' : null,
          duplicate_score: null,
          error: null,
          thumbnail_url: PIXEL,
          medium_url: PIXEL,
        })),
      })),
    };
  }

  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/upload-batches', '');
    const method = request.method();
    const json = request.postDataJSON?.bind(request);
    this.requests.push({ url: `${method} ${path}`, body: path.endsWith('/photos') ? null : safe(json) });

    if (method === 'GET' && path === '') {
      return route.fulfill({ json: this.status === 'none' || this.status === 'closed' ? [] : [this.summary()] });
    }
    if (method === 'POST' && path === '') {
      this.status = 'uploading';
      return route.fulfill({ status: 201, json: this.summary() });
    }
    if (method === 'POST' && path.endsWith('/photos')) {
      const keys = (request.postData() ?? '').match(/name="upload_keys"/g)?.length ?? 0;
      this.photos += keys;
      return route.fulfill({
        status: 201,
        json: {
          total: keys,
          successful: keys,
          failed: 0,
          results: Array.from({ length: keys }, (_, i) => ({ filename: `f${i}`, success: true })),
        },
      });
    }
    if (method === 'POST' && path.endsWith('/seal')) {
      this.status = 'review';
      this.garments = [
        { group_id: 'g-shirt', photos: 2, tags: { type: 'shirt', primary_color: 'white' }, duplicate: false },
        { group_id: 'g-jeans', photos: 1, tags: null, duplicate: true },
      ];
      return route.fulfill({ json: this.summary() });
    }
    if (method === 'PATCH' && path.endsWith('/groups')) {
      const body = json() as { group_ids: string[]; changes: Tags };
      for (const g of this.garments) {
        if (body.group_ids.includes(g.group_id)) g.tags = { ...(g.tags ?? {}), ...body.changes };
      }
      return route.fulfill({ json: this.detail() });
    }
    const notDuplicate = path.match(/\/groups\/([^/]+)\/not-duplicate$/);
    if (method === 'POST' && notDuplicate) {
      const g = this.garments.find((x) => x.group_id === notDuplicate[1])!;
      // As if the analysis had already answered.
      g.duplicate = false;
      g.tags = { type: 'jeans', primary_color: 'blue' };
      return route.fulfill({ json: this.detail() });
    }
    if (method === 'POST' && path.endsWith('/confirm')) {
      const body = json() as { group_ids: string[] | null };
      const chosen = this.garments.filter(
        (g) => !g.duplicate && g.tags?.type && (body.group_ids === null || body.group_ids.includes(g.group_id)),
      );
      this.garments = this.garments.filter((g) => !chosen.includes(g));
      if (this.garments.length === 0) this.status = 'closed';
      return route.fulfill({
        json: { ...this.detail(), created_item_ids: chosen.map((g) => `item-${g.group_id}`), skipped: {} },
      });
    }
    if (method === 'GET') return route.fulfill({ json: this.detail() });
    return route.fulfill({ status: 404, json: { detail: `unhandled ${method} ${path}` } });
  }
}

function safe(read: (() => unknown) | undefined) {
  try {
    return read?.() ?? null;
  } catch {
    return null;
  }
}

test('uploads photos, resolves a possible duplicate and confirms every garment', async ({ page }) => {
  const inbox = new FakeInbox();
  await page.route('**/api/v1/upload-batches**', (route) => inbox.handle(route));
  await page.route('**/api/v1/health/features', (route) =>
    route.fulfill({ json: { max_upload_size_mb: 50, max_bulk_upload_count: 20, background_removal: true, batch_upload: true } }),
  );

  await login(page);
  await page.goto('/dashboard/inbox');
  await expect(page.getByRole('heading', { name: 'Da rivedere' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Da rivedere' }).first()).toBeVisible();

  const photo = { mimeType: 'image/png', buffer: Buffer.from(PIXEL.split(',')[1], 'base64') };
  await page.getByTestId('batch-upload-input').setInputFiles([
    { name: 'front.png', ...photo },
    { name: 'back.png', ...photo },
    { name: 'jeans.png', ...photo },
  ]);

  const cards = page.getByTestId('garment-card');
  await expect(cards).toHaveCount(2);
  expect(inbox.photos).toBe(3);
  expect(inbox.requests.map((r) => r.url)).toContain(`POST /${BATCH}/seal`);

  // The shirt: give it a brand.
  await cards.nth(0).getByRole('button', { name: 'Modifica' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Marca').fill('Uniqlo');
  await dialog.getByRole('button', { name: 'Salva' }).click();
  await expect(cards.nth(0)).toContainText('Uniqlo');
  expect(inbox.requests.find((r) => r.url.startsWith('PATCH'))?.body).toEqual({
    group_ids: ['g-shirt'],
    changes: { brand: 'Uniqlo' },
  });

  // The jeans look like an item already in the wardrobe; the user says they are new.
  const jeans = cards.nth(1);
  await expect(jeans).toContainText('Jeans blu');
  await expect(jeans.getByRole('button', { name: 'Conferma' })).toBeDisabled();
  await jeans.getByRole('button', { name: 'È un capo nuovo' }).click();
  await expect(jeans.getByRole('button', { name: 'Conferma' })).toBeEnabled();

  await page.getByRole('button', { name: 'Conferma i pronti (2)' }).click();
  await expect(page.getByText('Tutte le foto di questo caricamento sono sistemate.')).toBeVisible();
  expect(inbox.requests.find((r) => r.url.endsWith('/confirm'))?.body).toEqual({ group_ids: null });
});
