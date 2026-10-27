// Fork: Wearly hides upstream features it does not show, without deleting them. Remove a section
// from HIDDEN_SECTIONS to bring it back: its menu entry stays out (lib/navigation.ts), but its
// pages, buttons and settings cards come back.
export type Section = 'family' | 'learning' | 'pairings' | 'aiEndpoints' | 'bodyMeasurements';

export const HIDDEN_SECTIONS: ReadonlySet<Section> = new Set<Section>([
  'family',
  'learning',
  'pairings',
  'aiEndpoints',
  'bodyMeasurements',
]);

export function isSectionVisible(section: Section, hidden: ReadonlySet<Section> = HIDDEN_SECTIONS): boolean {
  return !hidden.has(section);
}
