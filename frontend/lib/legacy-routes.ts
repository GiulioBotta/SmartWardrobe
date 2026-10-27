// Fork: old addresses keep working. Pages that moved in the Wearly redesign redirect to their new
// place (the backend's notification links still point at the old ones), and hidden pages send
// people home instead of showing a page the menu no longer has.
import { HIDDEN_SECTIONS, isSectionVisible, type Section } from '@/lib/sections';

const MOVED: Record<string, string> = {
  '/dashboard/history': '/dashboard/outfits?tab=history',
  '/dashboard/notifications': '/dashboard/settings#notifications',
  '/dashboard/today': '/dashboard',
};

const HIDDEN_PAGES: [string, Section][] = [
  ['/dashboard/family', 'family'],
  ['/dashboard/learning', 'learning'],
  ['/dashboard/pairings', 'pairings'],
];

export function legacyRedirect(
  pathname: string,
  hidden: ReadonlySet<Section> = HIDDEN_SECTIONS,
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (MOVED[path]) return MOVED[path];
  for (const [prefix, section] of HIDDEN_PAGES) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && !isSectionVisible(section, hidden)) {
      return '/dashboard';
    }
  }
  return null;
}
