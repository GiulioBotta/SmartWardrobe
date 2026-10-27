'use client';

// Fork: the greeting at the top of Wearly's home — name, weekday and, when known, the weather.
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useWeatherConditionLabel } from '@/lib/hooks/use-translated-constants';
import { useWeather } from '@/lib/hooks/use-weather';
import { displayValue, tempSymbol, type TempUnit } from '@/lib/temperature';

export function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 13) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function Greeting({ today }: { today: string }) {
  const t = useTranslations('wearly.today.greeting');
  const locale = useLocale();
  const { data: session } = useSession();
  const { data: weather } = useWeather();
  const { data: prefs } = usePreferences();
  const conditionLabel = useWeatherConditionLabel();
  const unit: TempUnit = prefs?.temperature_unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const name = session?.user?.name?.split(' ')[0];
  const day = new Date(`${today}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const parts = [day];
  if (weather) {
    parts.push(`${displayValue(weather.temperature, unit)}${tempSymbol(unit)} ${conditionLabel(weather.condition).toLocaleLowerCase(locale)}`);
  }

  return (
    <div>
      <h1 className="font-serif text-3xl tracking-tight">
        {name ? t(greetingKey(new Date().getHours()), { name }) : t(`${greetingKey(new Date().getHours())}NoName`)}
      </h1>
      <p className="mt-1 font-serif italic text-muted-foreground">{parts.join(' · ')}</p>
    </div>
  );
}
