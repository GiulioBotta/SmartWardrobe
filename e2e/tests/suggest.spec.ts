import { expect, test, type Page, type Route } from '@playwright/test';

// The suggestion page with several pinned items, the filter panel and swapping one item.
// Login and the wardrobe are real (dev login, the dev user's items); the AI-backed calls are
// answered here so the test never spends provider quota and does not depend on the model.

interface PickedItem {
  id: string;
  type: string;
  name: string | null;
  primary_color: string | null;
  colors: string[];
}

function outfitItem(item: PickedItem, position: number) {
  return {
    id: item.id,
    type: item.type,
    subtype: null,
    name: item.name,
    primary_color: item.primary_color,
    colors: item.colors ?? [],
    image_path: null,
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    layer_type: null,
    position,
  };
}

function outfit(id: string, title: string, items: PickedItem[]) {
  return {
    id,
    occasion: 'casual',
    scheduled_for: null,
    status: 'pending',
    source: 'on_demand',
    reasoning: title,
    style_notes: null,
    highlights: null,
    weather: null,
    items: items.map(outfitItem),
    feedback: null,
    created_at: new Date().toISOString(),
  };
}

const EXTRA: PickedItem = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'sneakers',
  name: 'E2E sneakers',
  primary_color: 'white',
  colors: ['white'],
};
const REPLACEMENT: PickedItem = {
  id: '00000000-0000-4000-8000-000000000002',
  type: 'boots',
  name: 'E2E boots',
  primary_color: 'brown',
  colors: ['brown'],
};

// Dev login maps an email to its user, so this must be the account that holds the wardrobe;
// a new email would create an empty user that lands on onboarding.
const EMAIL = process.env.E2E_EMAIL ?? 'giulio@wardrobe.test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('dev@example.com').fill(EMAIL);
  await page.getByRole('button', { name: /^(accedi|sign in)$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function pinTwoItems(page: Page): Promise<PickedItem[]> {
  const items = page.waitForResponse((r) => r.url().includes('/api/v1/items') && r.request().method() === 'GET');
  await page.getByTestId('pinned-add').click();
  const listing = await (await items).json();
  const dialog = page.getByRole('dialog');
  const tiles = dialog.locator('button:has(img), button:has(svg.lucide-shirt)');
  await expect(tiles.first()).toBeVisible();
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await dialog.getByTestId('pinned-done').click();
  await expect(page.getByTestId('pinned-items').locator('> div')).toHaveCount(2);
  return (listing.items as PickedItem[]).slice(0, 2);
}

test('pins several items, sends the filters and swaps one piece', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/suggest');
  await page.getByRole('button', { name: /^casual$/i }).first().click();

  const pinned = await pinTwoItems(page);

  await page.getByTestId('filters-toggle').click();
  await page.getByTestId('filter-color-navy').click();
  await page.getByTestId('filter-color-red').click();
  await page.getByTestId('filter-color-red').click();
  await page.getByTestId('filter-skip-shorts').click();
  await expect(page.getByTestId('filter-color-red')).toHaveAttribute('data-choice', 'avoid');

  let suggestBody: Record<string, unknown> | null = null;
  const options = [
    outfit('00000000-0000-4000-8000-0000000000a1', 'E2E look one', [...pinned, EXTRA]),
    outfit('00000000-0000-4000-8000-0000000000a2', 'E2E look two', pinned),
  ];
  await page.route('**/api/v1/outfits/suggest-options', async (route: Route) => {
    suggestBody = route.request().postDataJSON();
    await route.fulfill({ json: options });
  });
  await page.route('**/api/v1/outfits/*/skip', (route) => route.fulfill({ json: {} }));

  await page.getByRole('button', { name: /ottieni suggerimento|get suggestion/i }).click();
  await expect(page.getByText('E2E look one')).toBeVisible();

  expect(suggestBody).not.toBeNull();
  expect(suggestBody!.include_items).toEqual(pinned.map((p) => p.id));
  expect(suggestBody!.filters).toEqual({
    colors: ['navy'],
    exclude_colors: ['red'],
    exclude_types: ['shorts'],
  });

  // Pinned pieces cannot be swapped; the third one can.
  await expect(page.getByTestId('swap-item')).toHaveCount(1);

  await page.route('**/api/v1/outfits/*/swap-options**', (route) =>
    route.fulfill({ json: [outfitItem(REPLACEMENT, 0)] }),
  );
  let patchBody: Record<string, unknown> | null = null;
  await page.route('**/api/v1/outfits/00000000-0000-4000-8000-0000000000a1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patchBody = route.request().postDataJSON();
    await route.fulfill({ json: outfit(options[0].id, 'E2E look one', [...pinned, REPLACEMENT]) });
  });

  await page.getByTestId('swap-item').click();
  await page.getByTestId('swap-option').first().click();

  await expect(page.getByText('E2E boots')).toBeVisible();
  await expect(page.getByText('E2E sneakers')).toHaveCount(0);
  expect(patchBody!.items).toEqual([...pinned.map((p) => p.id), REPLACEMENT.id]);
});
