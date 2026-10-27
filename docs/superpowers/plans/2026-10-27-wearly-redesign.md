# Wearly redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Wardrowbe frontend into "Wearly": Caffè e crema / moka calda theme (light + dark), new name and drawer logo, a four-entry menu (Oggi · Armadio · Outfit · Altro), an "Oggi" home that replaces the dashboard, hidden extra features, and a restyle of the daily pages.

**Architecture:** Frontend only. Colours and fonts change in the central theme files, so every page picks them up. New brand, navigation and home live in new modules; upstream pages are touched only to hook them in, to hide sections, or for the restyle. Hidden features stay in the code behind a static config; old URLs redirect in `middleware.ts`.

**Tech Stack:** Next.js 14 (app router), Tailwind, shadcn/ui, next-intl, next-themes, React Query, vitest, Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-27-wearly-redesign-design.md`

## Global Constraints

- Backend: no changes.
- Palette (spec, exact):
  light — page `#f8f1e7`, surfaces `#efe3d3`, text `#3b2a20`, secondary text `#8a6a52`, borders `#d8c6b2`, brand accent `#8f705c`, primary button `#3b2a20` on `#f8f1e7`;
  dark — page `#241a15`, surfaces `#322520`, text `#f3e8da`, secondary text `#b59b86`, borders `#4a3a30`, brand accent `#cdac94`, primary button `#f3e8da` on `#241a15`.
- Theme follows the system (`defaultTheme="system"`), manual toggle kept.
- Name in one place: `APP_NAME = 'Wearly'` (temporary name).
- Logo: drawer, `viewBox="0 0 40 40"`, `<rect x="7" y="9" width="26" height="22" rx="3"/><path d="M7 20 H33"/><path d="M17 14.5 H23"/><path d="M17 25.5 H23"/>`, stroke `#f3e8da`, width 2.4, round caps, no fill, on a `#3b2a20` rounded square.
- Hide, never delete: hidden features stay in the code and come back by editing one config file.
- Every control the daily pages have today stays (restyle, not rethink).
- Works at 375 px wide with no horizontal scroll; the bottom bar never covers content.
- Copy: Italian and English written; the other 6 locales get the English text. New strings in a new `wearly` namespace.
- No new heavy dependencies (Mac M1, 8 GB). Fonts via `next/font/google`, as Inter already is.
- All suites green at the end: `pytest`, `vitest`, Playwright. Upstream tests that check changed text or menus are updated, never skipped.
- CLAUDE.md: commits only when the user asks. Work on branch `feat/wearly-redesign`; tasks end with a checkpoint, not a commit.

## Review Focus

1. A user who bookmarked or receives a notification link to `/dashboard/history`, `/dashboard/notifications`, `/dashboard/wardrobe` → lands on the right new place, not a 404 or a hidden page (Task 3).
2. An "Oggi" home with no weather (location not set) and an empty wardrobe → still renders the "Cosa indossi oggi?" box and sensible empty states (Task 5).
3. A scheduled outfit pending for today and also one already logged today → shows the logged one, and the pending one only if not yet answered; "Scarta" must not exclude its items from later suggestions (uses `/skip`, not `/reject`) (Task 5).
4. Dark theme on every page, including untouched ones (Analisi, Impostazioni, Da rivedere, login): text stays readable — secondary text on surfaces (Task 1, Task 8 screenshots).
5. Batch upload off (`batch_upload` false) → "Altro" shows no "Da rivedere" and the home shows no inbox reminder (Task 4, Task 5).

---

### Task 1: Theme tokens and fonts

**Files:**
- Modify: `frontend/app/globals.css` (the `:root` and `.dark` blocks), `frontend/tailwind.config.js` (`fontFamily`, `colors`), `frontend/app/layout.tsx` (font loading)
- Test: `frontend/tests/wearly-theme.test.ts`

**Interfaces:**
- Produces: CSS variables `--brand` / `--brand-foreground` and Tailwind colours `brand`, `brand-foreground`; Tailwind `font-serif` (title font); utility class `label-caps` (small uppercase, letter-spacing ≈ 0.1em, `text-[0.65rem]` or similar, secondary text colour). Later tasks use `font-serif`, `text-brand`, `bg-brand`, `label-caps`.

Token mapping (shadcn names → spec roles), same in `:root` and `.dark` with the dark values:
`--background`, `--card`, `--popover` = page; `--foreground`, `--card-foreground`, `--popover-foreground` = text; `--secondary`, `--muted`, `--accent` = surfaces (accent is shadcn's hover surface, not the brand colour); `--muted-foreground` = secondary text; `--border`, `--input` = borders; `--primary` / `--primary-foreground` = primary button; `--brand` = brand accent; `--brand-foreground` = page colour; `--ring` = brand accent. `--destructive` keeps upstream values.

- [ ] **Step 1: Write the failing test** `tests/wearly-theme.test.ts`: read `app/globals.css` as text, extract the HSL triplets of `:root` and `.dark`, convert each to hex, and assert each is within 1 per RGB channel of the spec value for its role (table above), e.g. `expect(hex(root['--background'])).toBeCloseHex('#f8f1e7')`, `hex(dark['--brand'])` ≈ `#cdac94`, `hex(root['--primary'])` ≈ `#3b2a20`. Also assert `tailwind.config.js` exposes `colors.brand` and `fontFamily.serif`.
- [ ] **Step 2: Run** `docker run --rm -v "$PWD":/repo -v smartwardrobe_frontend_node_modules:/repo/frontend/node_modules -w /repo/frontend --entrypoint sh ghcr.io/anyesh/wardrowbe:frontend-latest -c "npx vitest run tests/wearly-theme.test.ts"` from the repo root. Expected: FAIL (upstream grey values).
- [ ] **Step 3: Implement** the tokens; load **Gelasio** (Georgia-metric serif) with `next/font/google` as `--font-serif` next to Inter in `app/layout.tsx`, add `fontFamily.serif: ['var(--font-serif)', 'Georgia', 'serif']`; add `label-caps` in `@layer components`.
- [ ] **Step 4: Run** the test again. Expected: PASS. Run the full vitest suite. Expected: all green.
- [ ] **Step 5: Checkpoint** — open `/dashboard/wardrobe` in light and dark: everything is cream/espresso, no grey-blue left.

### Task 2: Brand (name, logo, icons)

**Files:**
- Create: `frontend/lib/brand.ts`, `frontend/components/brand/logo-mark.tsx`, `frontend/scripts/generate_brand_icons.py`
- Modify: `frontend/app/layout.tsx` (`metadata.title`, `description`), `frontend/app/page.tsx`, `frontend/app/login/page.tsx`, `frontend/app/onboarding/page.tsx` (logo + name where the brand shows), regenerate `frontend/public/logo.svg`, `favicon.ico`, `icon-{16,32,48,96,128,192,256,512}.png`, `apple-touch-icon.png`
- Test: `frontend/tests/wearly-brand.test.tsx`; update `frontend/tests/login-page.test.tsx` if it asserts the old name

**Interfaces:**
- Produces: `APP_NAME: string` (`'Wearly'`), `APP_DESCRIPTION: string` in `lib/brand.ts`; `LogoMark({ size?: number; className?: string }): JSX.Element` — the drawer on the rounded espresso square, `aria-hidden`.

- [ ] **Step 1: Write the failing test**: `render(<LogoMark size={32} />)` produces an `svg` with a `rect` (`x=7 y=9 width=26 height=22 rx=3`) and three `path`s; `APP_NAME === 'Wearly'`; `metadata.title` exported by `app/layout.tsx` equals `APP_NAME` (import the module's `metadata`).
- [ ] **Step 2: Run** the test file. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `brand.ts`, `LogoMark`; use them in layout metadata, landing, login, onboarding (replace `/logo.svg` images and the hard-coded brand text). Write `generate_brand_icons.py` with Pillow drawing the same shapes (scale from the 40×40 viewBox, stroke 2.4, rounded square radius ≈ 22% of the side) and writing every PNG and the multi-size `favicon.ico`; write `logo.svg` by hand from the spec markup. Run it with the backend image (it has Pillow): `docker run --rm -v "$PWD":/repo -w /repo/frontend --entrypoint python ghcr.io/anyesh/wardrowbe:backend-latest scripts/generate_brand_icons.py`.
- [ ] **Step 4: Run** the brand test and the full vitest suite. Expected: PASS. Visually check `/login` and the browser tab icon.
- [ ] **Step 5: Checkpoint.**

### Task 3: Hidden sections and old URLs

**Files:**
- Create: `frontend/lib/sections.ts`, `frontend/lib/legacy-routes.ts`
- Modify: `frontend/middleware.ts` (one call before the auth handling), `frontend/components/item-detail-dialog.tsx` (pairings button + dialog), `frontend/app/dashboard/outfits/page.tsx` (`pairings` filter chip), `frontend/app/dashboard/settings/page.tsx` (AI endpoints card, body measurements card)
- Test: `frontend/tests/wearly-sections.test.ts`

**Interfaces:**
- Produces:
  - `type Section = 'family' | 'learning' | 'pairings' | 'aiEndpoints' | 'bodyMeasurements'`
  - `HIDDEN_SECTIONS: ReadonlySet<Section>` (all five today) and `isSectionVisible(section: Section): boolean`
  - `legacyRedirect(pathname: string, hidden: ReadonlySet<Section> = HIDDEN_SECTIONS): string | null` — `/dashboard/history` → `/dashboard/outfits?view=history`; `/dashboard/notifications` → `/dashboard/settings#notifications`; `/dashboard/today` → `/dashboard`; `/dashboard/family`, `/dashboard/family/feed`, `/dashboard/learning`, `/dashboard/pairings` → `/dashboard` **only while their section is hidden**; anything else (including `/dashboard/wardrobe`, `/dashboard/outfits/123`) → `null`.

- [ ] **Step 1: Write the failing tests**: `isSectionVisible('family') === false` for each hidden section; `legacyRedirect` table above, including `legacyRedirect('/dashboard/wardrobe') === null`, `legacyRedirect('/dashboard/outfits/abc') === null`, and that `/dashboard/pairings` maps to `null` when `pairings` is not hidden (test with an injectable set: `legacyRedirect(pathname, hidden = HIDDEN_SECTIONS)`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** both modules; in `middleware.ts` return `NextResponse.redirect(new URL(target, request.url))` when `legacyRedirect` answers (keep the query string of the target, drop the old one). Wrap the pairings button/dialog, the `pairings` chip and the two settings cards with `isSectionVisible(...)`.
- [ ] **Step 4: Run** the new tests and full vitest (`pairings-load-more.test.tsx` still renders the pairings page itself, which stays in the code). Expected: PASS.
- [ ] **Step 5: Checkpoint** — opening `/dashboard/family` in the browser lands on `/dashboard`; `/dashboard/history` lands on `/dashboard/outfits?view=history` (the Cronologia tab itself arrives in Task 6).

### Task 4: Navigation (sidebar, bottom bar, Altro, header)

**Files:**
- Create: `frontend/lib/navigation.ts`, `frontend/app/dashboard/more/page.tsx`, `frontend/messages/*/wearly.json` (8 locales; it + en written, others = en)
- Modify: `frontend/components/sidebar.tsx`, `frontend/components/mobile-nav.tsx`, `frontend/components/header.tsx`, `frontend/app/dashboard/layout.tsx` (drop `MobileSidebar` and the menu button), `frontend/lib/i18n/locales.ts` (`'wearly'` namespace)
- Delete: `frontend/lib/hooks/use-quick-log.ts` (its `useTodayNavItem` is replaced)
- Test: `frontend/tests/wearly-navigation.test.tsx`

**Interfaces:**
- Consumes: `useBatchUploadEnabled()` from `lib/hooks/use-batch-inbox.ts`; `LogoMark`, `APP_NAME` (Task 2).
- Produces: `type NavEntry = { key: string; href: string; icon: LucideIcon }`; `useNavigation(): { primary: NavEntry[]; more: NavEntry[] }` — primary `today` `/dashboard` (CalendarCheck), `wardrobe` `/dashboard/wardrobe` (Shirt), `outfits` `/dashboard/outfits` (LayoutGrid); more `inbox` `/dashboard/inbox` (Inbox, only when batch upload is on), `analytics` `/dashboard/analytics` (BarChart3), `settings` `/dashboard/settings` (Settings). Labels from `wearly.nav.<key>` (it: Oggi, Armadio, Outfit, Altro, Da rivedere, Analisi, Impostazioni). `isActive(href: string, pathname: string): boolean` — `/dashboard` only on exact match; `/dashboard/outfits` also active on `/dashboard/outfits/...`; "Altro" active on `/dashboard/more` and on every `more` entry.

Desktop sidebar: `LogoMark` + `APP_NAME` in serif at the top, the three primary entries, then a small `label-caps` heading "Altro" and the `more` entries; active entry `text-brand` with a subtle `bg-secondary`. Bottom bar (`lg:hidden`, `h-16`): Oggi · Armadio · Outfit · Altro (Altro → `/dashboard/more`). `/dashboard/more`: a list of the `more` entries as large rows. Header: on mobile shows `LogoMark` + name (no hamburger); keeps theme toggle, locale switcher, sign out.

- [ ] **Step 1: Write the failing tests**: `useNavigation()` (mock `useBatchUploadEnabled`) returns primary keys `['today','wardrobe','outfits']`, more `['inbox','analytics','settings']` when on and `['analytics','settings']` when off; `isActive` cases: (`/dashboard`, `/dashboard/wardrobe`) false, (`/dashboard`, `/dashboard`) true, (`/dashboard/outfits`, `/dashboard/outfits/x`) true; rendering `MobileNav` at `/dashboard/settings` marks "more" active.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the upstream entries (family, learning, pairings, history, notifications, suggest) and the fork's `useTodayNavItem` / `useInboxNavItem` uses from both sidebars; delete `components/mobile-sidebar.tsx` only if nothing else imports it.
- [ ] **Step 4: Run** the tests and full vitest; fix upstream tests that assert old menu entries (e.g. `header-logout.test.tsx`) by updating expectations. Expected: PASS.
- [ ] **Step 5: Checkpoint** — at 375 px the bottom bar has four entries; at desktop width the sidebar shows the three + "Altro" group.

### Task 5: "Oggi" home (replaces the dashboard)

**Files:**
- Create: `frontend/components/today/today-box.tsx`, `frontend/components/today/greeting.tsx`, `frontend/components/today/recent-worn.tsx`, `frontend/components/today/inbox-reminder.tsx`
- Move: `WeeklySummaryCard`, `NextScheduledCard`, `NotificationStatusCard` out of `frontend/app/dashboard/page.tsx` into `frontend/components/legacy/weekly-summary-card.tsx`, `next-scheduled-card.tsx`, `notification-status-card.tsx` (unchanged bodies)
- Modify: `frontend/app/dashboard/page.tsx` (becomes the home), `frontend/app/dashboard/today/page.tsx` (content moves into the home; the route itself is redirected by Task 3), `frontend/lib/quick-log.ts` (add `pendingForToday`)
- Delete: `frontend/components/today/today-log-card.tsx`
- Test: `frontend/tests/quick-log.test.tsx` (extend), `frontend/tests/wearly-today.test.tsx`; update `frontend/tests/zero-rates.test.tsx` to render `WeeklySummaryCard` from its new file instead of the dashboard page

**Interfaces:**
- Consumes: `wornToday`, `outfitsToRepeat`, `groupBySlot`, `logWornToday`, `wearSuggestionToday`, `daysAgo` (`lib/quick-log.ts`); `ItemPickerGrid`, `OutfitStrip`; `usePendingOutfits` (`lib/hooks/use-outfits.ts`); `useWeather`; `useOpenBatches`, `useBatchUploadEnabled`.
- Produces: `pendingForToday(outfits: Outfit[], today: string): Outfit | null` — the first outfit with `scheduled_for === today`, status `pending`/`sent`/`viewed`, and no `feedback.worn_at`; `skipSuggestion(outfitId: string): Promise<void>` (POST `/outfits/{id}/skip`) in `lib/quick-log.ts`. `TodayBox` props: `{ today: string; loggedToday: Outfit[]; pending: Outfit | null; onPick(): void; onRepeat(): void }`.

Home layout, top to bottom (spec "Schermata Oggi"): `Greeting` (serif "Buongiorno, {name}", then weekday · temperature · condition, or only the weekday without weather); `TodayBox` (logged today → strips + "Aggiungi un altro"; else pending scheduled outfit → its strip with "Lo metto oggi" (`wearSuggestionToday`) and "Scarta" (`skipSuggestion`); else "Proponimi un outfit" primary link to `/dashboard/suggest` plus "Scelgo io" and "Rimetti un look" secondary buttons); below the box, the section chosen with "Scelgo io" (the pick grid with occasion bar, from today page) or "Rimetti un look" (repeat list); `RecentWorn` (last worn outfits' strips, from `outfitsToRepeat`); `InboxReminder` (when batch upload is on and an open batch has garments to review: "N capi da rivedere" → `/dashboard/inbox`). `NextScheduledCard` and `NotificationStatusCard` go to Settings (Task 7), `WeeklySummaryCard` to Analisi (Task 7).

- [ ] **Step 1: Write the failing tests**: `pendingForToday` picks the today pending one, ignores yesterday's, accepted ones and ones with `worn_at`; `skipSuggestion('o1')` calls `/api/v1/outfits/o1/skip`; `TodayBox` renders the three buttons when nothing is logged and nothing pending, the pending outfit with "Lo metto oggi"/"Scarta" when pending, and the logged strip (and no pending block) when both exist; home renders with `useWeather` returning no data (no crash, weekday shown).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, reusing the today page code; strings under `wearly.today.*` (move the `quickLog` strings the home uses, keep `quickLog` for the suggest button).
- [ ] **Step 4: Run** the tests and full vitest. Expected: PASS.
- [ ] **Step 5: Checkpoint** — at 375 px and desktop the empty state looks right and no "You're not in a family" toast appears; the pending and logged states are covered by the Step 1 tests (do not log real wears on the dev account to see them).

### Task 6: Outfit page with Cronologia

**Files:**
- Modify: `frontend/app/dashboard/outfits/page.tsx`, `frontend/app/dashboard/history/page.tsx` (export its content as a named component)
- Test: `frontend/tests/wearly-outfits-history.test.tsx`; update `frontend/tests/outfits-load-more.test.tsx` if the default view changes

**Interfaces:**
- Produces: `export function HistoryView(): JSX.Element` in `app/dashboard/history/page.tsx` (the page default export renders it); Outfit page reads `?view=history` and shows two tabs, "Look" (current content) and "Cronologia" (`HistoryView`), switching updates the URL.

- [ ] **Step 1: Write the failing test**: rendering the Outfit page with `?view=history` shows the history list (mock its hook) and the "Cronologia" tab selected; without the param the "Look" tab is selected and the grid renders.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and full vitest. Expected: PASS.
- [ ] **Step 5: Checkpoint.**

### Task 7: Settings (Notifiche section) and Analisi (weekly summary)

**Files:**
- Modify: `frontend/app/dashboard/settings/page.tsx`, `frontend/app/dashboard/notifications/page.tsx` (export content as `NotificationsSettings`), `frontend/app/dashboard/analytics/page.tsx`
- Test: `frontend/tests/wearly-settings.test.tsx`

**Interfaces:**
- Consumes: `NextScheduledCard`, `NotificationStatusCard`, `WeeklySummaryCard` (Task 5 files).
- Produces: `export function NotificationsSettings(): JSX.Element`; a Settings section with `id="notifications"` holding `NextScheduledCard`, `NotificationStatusCard` and `NotificationsSettings`; Analisi shows `WeeklySummaryCard` at the top.

- [ ] **Step 1: Write the failing test**: Settings renders an element with `id="notifications"` containing the channels and schedule UI (mock hooks); AI endpoints and body measurements cards are absent; Analisi renders the weekly summary.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and full vitest. Expected: PASS.
- [ ] **Step 5: Checkpoint** — `/dashboard/notifications` lands on Settings scrolled to Notifiche.

### Task 8: Restyle of the daily pages (Armadio + item card, Suggerisci, Outfit)

**Files:**
- Create: `frontend/components/brand/page-header.tsx`
- Modify: `frontend/app/dashboard/wardrobe/page.tsx`, `frontend/components/item-detail-dialog.tsx`, `frontend/app/dashboard/suggest/page.tsx`, `frontend/app/dashboard/outfits/page.tsx`, the item card component used by the wardrobe grid, plus `PageHeader` on Da rivedere, Analisi, Impostazioni, Altro, home

**Interfaces:**
- Produces: `PageHeader({ title: string; subtitle?: string; actions?: ReactNode })` — serif title (`font-serif`, ~`text-3xl`), secondary-text subtitle, actions aligned right (wrapping under on mobile).

What changes (no control removed — spec "Profondità del ridisegno"): page titles via `PageHeader`; item photos on `bg-secondary` tiles with more height than today; item names in serif, brand/material in `label-caps`; filter chips and active states in `brand`; primary actions `bg-primary`; secondary controls (bulk toolbar triggers, sort, view options) as outline/ghost so photos lead; generous spacing; the 375 px layout checked page by page.

- [ ] **Step 1: Write the failing test**: `PageHeader` renders the title in an `h1` with class `font-serif`, the subtitle, and the actions.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `PageHeader` and the restyle.
- [ ] **Step 4: Run** full vitest and all Playwright tests (`cd e2e && npm test`). Update `e2e/tests/today.spec.ts` (the home is now `/dashboard`, the dashboard card is gone; "Scelgo io" opens the grid) and any selector the restyle moved; `inbox.spec.ts` reaches "Da rivedere" from the sidebar "Altro" group. Expected: all PASS.
- [ ] **Step 5: Checkpoint** — screenshots at 375 px and desktop, light and dark, of: Oggi, Armadio + item dialog, Suggerisci, Outfit (both tabs), Altro, Da rivedere, Analisi, Impostazioni, login. Check secondary text contrast on `bg-secondary` in dark mode.

### Task 9: Final verification and notes

**Files:**
- Modify: `CLAUDE.md` (state: Wearly redesign, hidden sections in `lib/sections.ts`, name to replace later in `lib/brand.ts` + icons script), `docs/superpowers/specs/2026-10-27-wearly-redesign-design.md` (status: implemented)

- [ ] **Step 1: Run** backend `docker compose exec backend python -m pytest tests/ -q` (expected: unchanged, all pass), frontend `tsc --noEmit`, `eslint --quiet` on changed files, full vitest, full Playwright. Expected: all green.
- [ ] **Step 2:** Update the notes. Ask the user before committing (branch `feat/wearly-redesign`, then fast-forward `main`, per CLAUDE.md).
