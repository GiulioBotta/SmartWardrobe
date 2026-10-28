'use client';

// Fork: next to the sort menu — switch between the grouped wardrobe and the single grid, and
// open the dialog that orders the groups.
import { LayoutList, ListOrdered } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface WardrobeViewControlsProps {
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  onOrganize: () => void;
}

export function WardrobeViewControls({ grouped, onGroupedChange, onOrganize }: WardrobeViewControlsProps) {
  const t = useTranslations('wardrobeSections');
  return (
    <>
      <Button
        variant={grouped ? 'default' : 'outline'}
        size="icon"
        className="shrink-0"
        aria-pressed={grouped}
        aria-label={t('groupToggle')}
        title={t('groupToggle')}
        onClick={() => onGroupedChange(!grouped)}
      >
        <LayoutList className="h-4 w-4" />
      </Button>
      {grouped && (
        <Button variant="outline" className="shrink-0 gap-1.5" onClick={onOrganize}>
          <ListOrdered className="h-4 w-4" />
          <span className="hidden sm:inline">{t('organize.button')}</span>
          <span className="sr-only sm:hidden">{t('organize.button')}</span>
        </Button>
      )}
    </>
  );
}
