'use client';

import { Shirt } from 'lucide-react';
import type { OutfitItem } from '@/lib/types';

/** A look as a row of item thumbnails. */
export function OutfitStrip({ items }: { items: OutfitItem[] }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted"
          title={item.name ?? item.type}
        >
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.name ?? item.type} className="h-full w-full object-cover" />
          ) : (
            <Shirt className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  );
}
