'use client';

// Fork: Wearly's desktop menu — the brand, Oggi · Armadio · Outfit, then the "Altro" group.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogoMark } from '@/components/brand/logo-mark';
import { APP_NAME } from '@/lib/brand';
import { isActive, useNavigation, type NavEntry } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function NavLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm leading-6 transition-colors',
        active
          ? 'bg-secondary font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      )}
    >
      {/* The moka accent is too light for small text on the beige, so it marks the icon only. */}
      <entry.icon className={cn('h-5 w-5 shrink-0', active && 'text-brand')} aria-hidden="true" />
      {entry.name}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations('wearly.nav');
  const { primary, more } = useNavigation();

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
      <div className="flex grow flex-col gap-y-6 overflow-y-auto border-r bg-background px-6 pb-4">
        <div className="flex h-16 shrink-0 items-center">
          <Link href="/dashboard" className="flex items-center gap-3">
            <LogoMark size={32} />
            <span className="font-serif text-2xl tracking-tight">{APP_NAME}</span>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-y-6">
          <ul role="list" className="-mx-3 space-y-1">
            {primary.map((entry) => (
              <li key={entry.key}>
                <NavLink entry={entry} active={isActive(entry.href, pathname)} />
              </li>
            ))}
          </ul>
          <div>
            <div className="label-caps px-0">{t('more')}</div>
            <ul role="list" className="-mx-3 mt-2 space-y-1">
              {more.map((entry) => (
                <li key={entry.key}>
                  <NavLink entry={entry} active={isActive(entry.href, pathname)} />
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </aside>
  );
}
