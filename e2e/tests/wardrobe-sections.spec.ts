import { expect, test, type Page, type Route } from '@playwright/test';

// The grouped wardrobe: groups in the user's order, folding a group, and the Organize dialog.
// Login and the items are real (read only); /wardrobe-sections is answered here, so the test
// never changes the saved order. The backend's rules are covered by
// backend/tests/test_wardrobe_sections_api.py.

const EMAIL = process.env.E2E_EMAIL ?? 'giulio@wardrobe.test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('dev@example.com').fill(EMAIL);
  await page.getByRole('button', { name: /^(accedi|sign in)$/i }).click();
  await page.waitForURL(/\/dashboard/);
}

const KEYS = ['tops', 'knitwear', 'outerwear', 'trousers', 'footwear', 'accessories'];
const HIDDEN = ['skirts', 'dresses', 'suits', 'bags', 'hosiery'];

function sections() {
  return [...KEYS, ...HIDDEN].map((key, position) => ({
    id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    kind: 'category',
    key,
    name: null,
    position,
    enabled: KEYS.includes(key),
    item_ids: [],
  }));
}

test('wardrobe is grouped, groups fold, and Organize sends the new order', async ({ page }) => {
  const current = sections();
  const writes: { method: string; url: string; body: unknown }[] = [];

  await page.route('**/wardrobe-sections**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === 'GET' && url.includes('hidden-counts')) {
      return route.fulfill({ json: { skirts: 0, dresses: 0, suits: 0, bags: 0, hosiery: 0 } });
    }
    if (request.method() === 'GET') return route.fulfill({ json: { sections: current } });
    writes.push({ method: request.method(), url, body: request.postDataJSON() });
    return route.fulfill({ json: { sections: current } });
  });

  await login(page);
  await page.goto('/dashboard/wardrobe');

  const knitwear = page.getByRole('region', { name: /felpe e maglioni|sweaters and hoodies/i });
  await expect(knitwear).toBeVisible();
  const titles = await page.locator('section[data-kind] h2').allTextContents();
  const tops = titles.findIndex((t) => /magliette|tops/i.test(t));
  const knit = titles.findIndex((t) => /felpe|sweaters/i.test(t));
  if (tops !== -1) expect(tops).toBeLessThan(knit);

  // Fold the knitwear group and open it again.
  const toggle = knitwear.getByRole('button', { expanded: true });
  await toggle.click();
  await expect(knitwear.getByRole('button', { expanded: false })).toBeVisible();
  await knitwear.getByRole('button', { expanded: false }).click();

  // Organize: move the first group down and switch Skirts on.
  await page.getByRole('button', { name: /organizza|organize/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /sposta giù|move .* down/i }).first().click();
  await dialog.getByRole('switch', { name: /gonne|skirts/i }).click();

  await expect.poll(() => writes.length).toBeGreaterThanOrEqual(2);
  const order = writes.find((w) => w.url.endsWith('/order'));
  expect((order?.body as { ids: string[] }).ids.slice(0, 2)).toEqual([current[1].id, current[0].id]);
  const patch = writes.find((w) => w.method === 'PATCH');
  expect(patch?.body).toEqual({ enabled: true });
});
