// Fork: the hand-editable garment tags (pattern, material, formality), shared by the inbox
// edit dialog and the item edit form.
import type { ItemTags } from '@/lib/types';

export const PATTERN_VALUES = [
  'solid', 'striped', 'checkered', 'plaid', 'floral', 'polka-dot',
  'geometric', 'graphic', 'animal-print', 'camouflage',
] as const;

export type EditableTagField = 'pattern' | 'material' | 'formality';
export const EDITABLE_TAG_FIELDS: EditableTagField[] = ['pattern', 'material', 'formality'];

export type EditableTags = Record<EditableTagField, string>;

export function editableTagsFrom(tags: Partial<ItemTags> | null | undefined): EditableTags {
  return {
    pattern: tags?.pattern ?? '',
    material: tags?.material ?? '',
    formality: tags?.formality ?? '',
  };
}

// Only the fields the user changed: the backend merges tags, so sending the rest would
// overwrite them with the same values for nothing. An emptied field is sent as null to clear it.
export function tagChanges(
  before: Partial<ItemTags> | null | undefined,
  after: EditableTags,
): Partial<Record<EditableTagField, string | null>> | undefined {
  const original = editableTagsFrom(before);
  const changes: Partial<Record<EditableTagField, string | null>> = {};
  for (const field of EDITABLE_TAG_FIELDS) {
    if (after[field] !== original[field]) changes[field] = after[field] || null;
  }
  return Object.keys(changes).length ? changes : undefined;
}
