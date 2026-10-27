'use client';

// Fork: Wearly's bottom bar on the phone — Oggi · Armadio · Outfit · Altro.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MORE_HREF, isActive, useNavigation } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations('wearly.nav');
  const { primary, more } = useNavigation();
  const moreActive = isActive(MORE_HREF, pathname) || more.some((e) => isActive(e.href, pathname));
  const entries = [
    ...primary.map((e) => ({ ...e, active: isActive(e.href, pathname) })),
    { key: 'more', name: t('more'), href: MORE_HREF, icon: MoreHorizontal, active: moreActive },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur lg:hidden">
      <div className="flex h-16 items-center justify-around">
        {entries.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              'flex min-w-16 flex-col items-center gap-1 px-3 py-2 text-xs',
              // The moka accent is too light for small text on cream, so it marks the icon only.
              item.active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className={cn('h-5 w-5', item.active && 'text-brand')} aria-hidden="true" />
            <span>{item.name}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
