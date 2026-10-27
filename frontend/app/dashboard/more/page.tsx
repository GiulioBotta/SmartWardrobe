'use client';

// Fork: the phone's "Altro" page — the entries that do not fit in the bottom bar.
import { PageHeader } from '@/components/brand/page-header';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNavigation } from '@/lib/navigation';

export default function MorePage() {
  const t = useTranslations('wearly');
  const { more } = useNavigation();
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.more')} />
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {more.map((entry) => (
          <li key={entry.key}>
            <Link href={entry.href} className="flex items-center gap-4 px-4 py-4 hover:bg-secondary/60">
              <entry.icon className="h-5 w-5 text-brand" aria-hidden="true" />
              <span className="flex-1 font-medium">{entry.name}</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
