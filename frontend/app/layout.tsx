import type { Metadata, Viewport } from 'next';
import { Gelasio, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import { Providers } from './providers';
import { LOCALE_METADATA, type SupportedLocale } from '@/lib/i18n/locales';
import { APP_DESCRIPTION, APP_NAME } from '@/lib/brand';

export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter', display: 'swap' });
// Wearly titles (font-serif).
const gelasio = Gelasio({ subsets: ['latin', 'latin-ext'], variable: '--font-serif', display: 'swap' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} dir={LOCALE_METADATA[locale as SupportedLocale]?.dir ?? 'ltr'} suppressHydrationWarning>
      <body className={`${inter.variable} ${gelasio.variable} font-sans`}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
