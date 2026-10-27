import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LogoMark } from '@/components/brand/logo-mark';
import { APP_NAME } from '@/lib/brand';

export default async function Home() {
  const t = await getTranslations('auth');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <div className="flex justify-center mb-6">
          <LogoMark size={80} />
        </div>
        <h1 className="font-serif text-4xl tracking-tight mb-4">
          {APP_NAME}
        </h1>
        <p className="text-muted-foreground mb-8">
          {t('tagline')}
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          {t('getStarted')}
        </Link>
      </div>
    </main>
  );
}
