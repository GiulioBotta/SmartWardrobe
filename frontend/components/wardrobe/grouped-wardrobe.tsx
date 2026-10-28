'use client';

// Fork: the wardrobe split into its groups (WARDROBE_SECTIONS_ENABLED), each under a title that
// folds it away. Which groups are folded is remembered on this device only.
import { useState, type ReactNode } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Item } from '@/lib/types';
import type { ItemGroup } from '@/lib/wardrobe-sections';

export const COLLAPSED_KEY = 'wearly.wardrobe.collapsedGroups';
export const GROUPED_KEY = 'wearly.wardrobe.grouped';

// Grouped is the default; '0' means the user switched back to the single grid on this device.
export function useGroupedView(): [boolean, (grouped: boolean) => void] {
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem(GROUPED_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const update = (value: boolean) => {
    setGrouped(value);
    try {
      localStorage.setItem(GROUPED_KEY, value ? '1' : '0');
    } catch {
      // Not remembered, still applied.
    }
  };
  return [grouped, update];
}

function readCollapsed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Private browsing or blocked storage: folding still works for this visit.
  }
}

export function useGroupTitle() {
  const t = useTranslations('wardrobeSections');
  return (group: Pick<ItemGroup, 'kind' | 'key' | 'name'>) =>
    group.kind === 'collection' ? group.name ?? '' : t(`names.${group.key ?? 'unsorted'}`);
}

interface GroupedWardrobeProps {
  groups: ItemGroup[];
  renderItem: (item: Item, groupId: string) => ReactNode;
}

export function GroupedWardrobe({ groups, renderItem }: GroupedWardrobeProps) {
  const t = useTranslations('wardrobeSections');
  const title = useGroupTitle();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  if (groups.length === 0) return null;

  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    setCollapsed(next);
    writeCollapsed(next);
  };

  return (
    <div className="space-y-8 pb-20">
      {groups.map((group) => {
        const open = !collapsed.includes(group.id);
        const name = title(group);
        return (
          <section key={group.id} data-kind={group.kind} aria-label={name}>
            <h2>
              <button
                type="button"
                aria-expanded={open}
                aria-label={open ? t('collapse', { name }) : t('expand', { name })}
                onClick={() => toggle(group.id)}
                className="flex w-full items-center gap-2 border-b border-border pb-2 text-left"
              >
                {group.kind === 'collection' && (
                  <Bookmark className="h-4 w-4 shrink-0 text-brand" aria-label={t('collectionBadge')} />
                )}
                <span className="font-serif text-xl leading-tight min-w-0 flex-1 break-words">{name}</span>
                <span className="label-caps shrink-0">{t('itemCount', { count: group.items.length })}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                  aria-hidden
                />
              </button>
            </h2>
            {open && (
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {group.items.map((item) => (
                  <div key={`${group.id}:${item.id}`}>{renderItem(item, group.id)}</div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
