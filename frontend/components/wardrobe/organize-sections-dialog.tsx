'use client';

// Fork: one list for categories and collections, ordered by drag (pointer, touch, keyboard) or by
// arrows; optional categories switched on and off below; collections renamed or deleted in place.
import { useState, type FormEvent } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useGroupTitle } from '@/components/wardrobe/grouped-wardrobe';
import { HIDDEN_SECTION_KEYS } from '@/lib/generated/wardrobe-sections';
import {
  useDeleteCollection,
  useHiddenCounts,
  useReorderSections,
  useResetSectionOrder,
  useUpdateSection,
  useWardrobeSections,
} from '@/lib/hooks/use-wardrobe-sections';
import { isVisibleSection, sectionErrorKey, type Section } from '@/lib/wardrobe-sections';

interface OrganizeSectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewCollection: () => void;
}

// Server refusals come with a code and are worded in the user's language; anything else gets
// the generic message.
function errorText(t: (key: string) => string, error: unknown, fallbackKey: string): string {
  return t(sectionErrorKey(error) ?? fallbackKey);
}

interface RowProps {
  section: Section;
  index: number;
  count: number;
  // A move is being saved: the next one waits, so two quick moves cannot land out of order.
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onDelete: (section: Section) => void;
}

function SectionRow({ section, index, count, busy, onMove, onDelete }: RowProps) {
  const t = useTranslations('wardrobeSections');
  const title = useGroupTitle();
  const update = useUpdateSection();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const name = title(section);
  const isCollection = section.kind === 'collection';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await update.mutateAsync({ id: section.id, data: { name: draft } });
    } catch (error) {
      toast.error(errorText(t, error, 'collection.error'));
    }
    setEditing(false);
  };

  return (
    <li
      ref={setNodeRef}
      data-testid="section-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 border-b border-border py-2 ${isDragging ? 'relative z-10 bg-card shadow-md' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground"
        aria-label={t('organize.drag', { name })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {isCollection && <Bookmark className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
      {editing ? (
        <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-1">
          <Input
            autoFocus
            maxLength={50}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8"
          />
          <Button type="submit" size="icon" variant="ghost" className="h-8 w-8" aria-label={t('organize.saveName')}>
            <Check className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 break-words">{name}</span>
      )}
      {isCollection && !editing && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t('organize.rename', { name })}
            onClick={() => {
              setDraft(section.name ?? '');
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t('organize.delete', { name })}
            onClick={() => onDelete(section)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        aria-label={t('organize.moveUp', { name })}
        disabled={busy || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        aria-label={t('organize.moveDown', { name })}
        disabled={busy || index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </li>
  );
}

export function OrganizeSectionsDialog({ open, onOpenChange, onNewCollection }: OrganizeSectionsDialogProps) {
  const t = useTranslations('wardrobeSections');
  const tc = useTranslations('common');
  const { data: sections = [] } = useWardrobeSections(open);
  const { data: counts = {} } = useHiddenCounts(open);
  const reorder = useReorderSections();
  const update = useUpdateSection();
  const reset = useResetSectionOrder();
  const remove = useDeleteCollection();
  const [toDelete, setToDelete] = useState<Section | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = [...sections].sort((a, b) => a.position - b.position);
  const visible = ordered.filter(isVisibleSection);
  const hidden = ordered.filter((s) => !isVisibleSection(s));
  const optional = HIDDEN_SECTION_KEYS.map((key) => ordered.find((s) => s.key === key)).filter(
    (s): s is Section => !!s,
  );

  const move = (from: number, to: number) => {
    if (reorder.isPending || to < 0 || to >= visible.length || from === to) return;
    const ids = [...arrayMove(visible, from, to), ...hidden].map((s) => s.id);
    reorder.mutate(ids, { onError: () => toast.error(t('organize.error')) });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(
      visible.findIndex((s) => s.id === active.id),
      visible.findIndex((s) => s.id === over.id),
    );
  };

  const toggle = async (section: Section, enabled: boolean) => {
    try {
      await update.mutateAsync({ id: section.id, data: { enabled } });
    } catch (error) {
      toast.error(errorText(t, error, 'organize.error'));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal">{t('organize.title')}</DialogTitle>
            <DialogDescription>{t('organize.description')}</DialogDescription>
          </DialogHeader>

          <p className="label-caps mt-2">{t('organize.inWardrobe')}</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul>
                {visible.map((section, index) => (
                  <SectionRow
                    key={section.id}
                    section={section}
                    index={index}
                    count={visible.length}
                    busy={reorder.isPending}
                    onMove={move}
                    onDelete={setToDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <p className="label-caps mt-4">{t('organize.optional')}</p>
          <p className="text-sm text-muted-foreground">{t('organize.optionalHint')}</p>
          <ul>
            {optional.map((section) => {
              const label = t(`names.${section.key}`);
              const count = counts[section.key ?? ''] ?? 0;
              return (
                <li key={section.id} className="flex items-center gap-3 border-b border-border py-2">
                  <span className="min-w-0 flex-1">{label}</span>
                  {count > 0 && (
                    <span data-testid={`would-hold-${section.key}`} className="label-caps">
                      {t('organize.wouldHold', { count })}
                    </span>
                  )}
                  <Switch
                    checked={section.enabled}
                    aria-label={label}
                    onCheckedChange={(checked) => toggle(section, checked)}
                  />
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="gap-1.5" onClick={onNewCollection}>
              <Plus className="h-4 w-4" />
              {t('collection.new')}
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={reset.isPending}
              onClick={() => reset.mutate(undefined, { onError: () => toast.error(t('organize.error')) })}
            >
              <RotateCcw className="h-4 w-4" />
              {t('organize.reset')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('organize.deleteTitle', { name: toDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('organize.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!toDelete) return;
                try {
                  await remove.mutateAsync(toDelete.id);
                } catch (error) {
                  toast.error(errorText(t, error, 'collection.error'));
                }
                setToDelete(null);
              }}
            >
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
