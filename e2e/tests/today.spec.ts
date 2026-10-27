import { expect, test, type Page, type Route } from '@playwright/test';

// The quick wear log: the "Today" page (repeat a past look, pick pieces by hand) and
// "Wearing it today" on a suggestion. The wardrobe is read for real; every call that would
// log a wear is answered here, so the dev history and wear counts stay untouched.

const EMAIL = process.env.E2E_EMAIL ?? 'giulio@wardrobe.test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('dev@example.com').fill(EMAIL);
  await page.getByRole('button', { name: /^(accedi|sign in)$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

function outfitItem(id: string, name: string) {
  return {
    id,
    type: 'shirt',
    subtype: null,
    name,
    primary_color: 'white',
    colors: ['white'],
    image_path: null,
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    layer_type: null,
    position: 0,
  };
}

function outfit(id: string, title: string, wornAt: string | null, items = [outfitItem(`${id}-i`, title)]) {
  return {
    id,
    occasion: 'casual',
    scheduled_for: wornAt,
    status: wornAt ? 'accepted' : 'pending',
    source: 'manual',
    name: title,
    reasoning: title,
    style_notes: null,
    highlights: null,
    weather: null,
    items,
    feedback: wornAt ? { rating: null, comment: null, worn_at: wornAt, actually_worn: null, wore_instead_items: null } : null,
    created_at: new Date().toISOString(),
  };
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

test('repeats a past look and logs hand-picked pieces as worn today', async ({ page }) => {
  const past = outfit('00000000-0000-4000-8000-0000000000c1', 'E2E last week', isoDaysAgo(5), [
    outfitItem('00000000-0000-4000-8000-0000000000d1', 'E2E shirt'),
    outfitItem('00000000-0000-4000-8000-0000000000d2', 'E2E chinos'),
  ]);
  await page.route('**/api/v1/outfits?**', (route) =>
    route.fulfill({ json: { outfits: [past], total: 1, page: 1, page_size: 100, has_more: false } }),
  );
  const logged: Record<string, unknown>[] = [];
  await page.route('**/api/v1/outfits/studio', async (route: Route) => {
    logged.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: outfit('00000000-0000-4000-8000-0000000000c9', 'logged', isoDaysAgo(0)) });
  });

  await login(page);
  await expect(page.getByTestId('today-log-card')).toBeVisible();
  await page.getByTestId('today-log-card').click();
  await page.waitForURL(/\/dashboard\/today/);
  await expect(page.getByRole('heading', { name: 'Cosa indossi oggi' })).toBeVisible();
  await expect(page.getByText('Niente ancora per oggi.')).toBeVisible();

  const repeatCard = page.getByTestId('repeat-outfit');
  await expect(repeatCard).toHaveCount(1);
  await repeatCard.getByRole('button', { name: 'Rimettilo oggi' }).click();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({
    items: ['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2'],
    occasion: 'casual',
    mark_worn: true,
  });

  // Pick two real pieces, switch the occasion, save.
  const tiles = page.getByTestId('today-item');
  await expect(tiles.first()).toBeVisible();
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await expect(page.getByText('2 capi scelti')).toBeVisible();
  await page.getByRole('button', { name: /^ufficio$/i }).click();
  await page.getByRole('button', { name: 'Salva come indossato oggi' }).click();
  await expect.poll(() => logged.length).toBe(2);
  expect(logged[1]).toMatchObject({ occasion: 'office', mark_worn: true });
  expect((logged[1].items as string[]).length).toBe(2);
  await expect(page.getByText('2 capi scelti')).toHaveCount(0);
});

test('"Wearing it today" accepts a suggestion and records the wear', async ({ page }) => {
  const look = outfit('00000000-0000-4000-8000-0000000000e1', 'E2E look to wear', null);
  await page.route('**/api/v1/outfits/suggest-options', (route) => route.fulfill({ json: [look] }));
  const calls: string[] = [];
  let feedback: Record<string, unknown> | null = null;
  await page.route(`**/api/v1/outfits/${look.id}/accept`, (route) => {
    calls.push('accept');
    return route.fulfill({ json: { ...look, status: 'accepted' } });
  });
  await page.route(`**/api/v1/outfits/${look.id}/feedback`, (route) => {
    calls.push('feedback');
    feedback = route.request().postDataJSON();
    return route.fulfill({ json: { id: 'f1', outfit_id: look.id } });
  });

  await login(page);
  await page.goto('/dashboard/suggest');
  await page.getByRole('button', { name: /^casual$/i }).first().click();
  await page.getByRole('button', { name: /ottieni suggerimento|get suggestion/i }).click();
  await expect(page.getByText('E2E look to wear').first()).toBeVisible();

  await page.getByRole('button', { name: 'Lo metto oggi' }).first().click();
  await expect(page.getByText('Registrato come indossato oggi')).toBeVisible();
  expect(calls).toEqual(['accept', 'feedback']);
  expect(feedback).toEqual({ accepted: true, worn: true, actually_worn: true });
});
