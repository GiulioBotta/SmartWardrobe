'use client';

import { useState, useEffect, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Shirt,
  Sparkles,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Cloud,
  Sun,
  CloudRain,
  Loader2,
  AlertCircle,
  Thermometer,
  Droplets,
  ChevronDown,
  MapPin,
  Wind,
  Cloudy,
  CloudSun,
  Snowflake,
  CalendarDays,
  CloudLightning,
  Layers,
  CalendarCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { OutfitFilterPanel } from '@/components/suggest/outfit-filter-panel';
import { PinnedItemsPicker } from '@/components/suggest/pinned-items-picker';
import { SwapItemDialog } from '@/components/suggest/swap-item-dialog';
import { useFeatures } from '@/lib/hooks/use-features';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invalidateEveryItemWearCache } from '@/lib/hooks/cache-invalidation';
import { queryKeys } from '@/lib/hooks/query-keys';
import { wearSuggestionToday } from '@/lib/quick-log';
import { EMPTY_FILTERS, OutfitFilters, toRequestFilters } from '@/lib/suggest-filters';
import { useOccasionLabel, useWeatherConditionLabel, useTypeLabel } from '@/lib/hooks/use-translated-constants';
import { useItem } from '@/lib/hooks/use-items';
import { api, ApiError } from '@/lib/api';
import { applySessionToken } from '@/lib/hooks/use-session-token';
import { CurrentWeather, Item, Outfit, OutfitItem, SuggestRequest } from '@/lib/types';
import { useWeather } from '@/lib/hooks/use-weather';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { cn, formatShortDate } from '@/lib/utils';
import { TempUnit, formatTemp, displayValue, toF, toCelsius } from '@/lib/temperature';

type Translator = (key: string, values?: Record<string, string | number>) => string;

const OVERRIDE_CONDITION_KEYS: Record<string, string> = {
  sunny: 'clear',
  cloudy: 'cloudy',
  rainy: 'rain',
};

// Weather condition to icon mapping
function getWeatherIcon(condition: string, isDay: boolean) {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return <CloudRain className="h-8 w-8" />;
  if (c.includes('snow')) return <Snowflake className="h-8 w-8" />;
  if (c.includes('thunder') || c.includes('storm')) return <CloudLightning className="h-8 w-8" />;
  if (c.includes('cloud') && c.includes('part')) return <CloudSun className="h-8 w-8" />;
  if (c.includes('cloud') || c.includes('overcast')) return <Cloudy className="h-8 w-8" />;
  return isDay ? <Sun className="h-8 w-8" /> : <Cloud className="h-8 w-8" />;
}

// Get time-based greeting key
function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'greeting.morning';
  if (hour < 17) return 'greeting.afternoon';
  return 'greeting.evening';
}

// Get weather-based outfit hint key
function getWeatherHintKey(weather: CurrentWeather): string {
  const temp = weather.temperature;
  const condition = weather.condition.toLowerCase();

  if (weather.precipitation_chance > 50) return 'weatherHints.rainy';
  if (temp < 10) return 'weatherHints.cold';
  if (temp < 18) return 'weatherHints.mild';
  if (temp > 28) return 'weatherHints.hot';
  if (condition.includes('wind')) return 'weatherHints.windy';
  return 'weatherHints.nice';
}

interface WeatherOverride {
  temperature: number;
  condition: 'sunny' | 'cloudy' | 'rainy';
}

function WeatherCard({ weather, isLoading, temperatureUnit, t }: { weather?: CurrentWeather; isLoading: boolean; temperatureUnit: TempUnit; t: Translator }) {
  const conditionLabel = useWeatherConditionLabel();
  if (isLoading) {
    return (
      <Card className="border-muted">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!weather) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <MapPin className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">{t('location.notSet')}</p>
              <p className="text-sm text-muted-foreground">
                {t('location.setDescription')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-foreground">
              {getWeatherIcon(weather.condition, weather.is_day)}
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{displayValue(weather.temperature, temperatureUnit)}</span>
                <span className="text-lg text-muted-foreground">{temperatureUnit === 'fahrenheit' ? '°F' : '°C'}</span>
              </div>
              <p className="text-sm text-muted-foreground">{conditionLabel(weather.condition)}</p>
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1.5 justify-end">
              <Thermometer className="h-3.5 w-3.5" />
              <span>{t('weather.feelsLike', { temp: displayValue(weather.feels_like, temperatureUnit) })}</span>
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              <Droplets className="h-3.5 w-3.5" />
              <span>{t('weather.rainChance', { chance: weather.precipitation_chance })}</span>
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              <Wind className="h-3.5 w-3.5" />
              <span>{t('weather.windSpeed', { speed: Math.round(weather.wind_speed) })}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {t(getWeatherHintKey(weather))}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherOverrideSection({
  weather,
  onChange,
  temperatureUnit,
  t,
}: {
  weather: WeatherOverride | null;
  onChange: (weather: WeatherOverride | null) => void;
  temperatureUnit: TempUnit;
  t: Translator;
}) {
  const tc = useTranslations('constants.weatherConditions');
  const [isOpen, setIsOpen] = useState(false);
  const conditions = [
    { value: 'sunny', icon: <Sun className="h-4 w-4" /> },
    { value: 'cloudy', icon: <Cloud className="h-4 w-4" /> },
    { value: 'rainy', icon: <CloudRain className="h-4 w-4" /> },
  ] as const;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
          <span>{weather ? t('weatherOverride.active') : t('weatherOverride.overrideWeather')}</span>
          {weather && (
            <Badge variant="secondary" className="text-xs">
              {tc(OVERRIDE_CONDITION_KEYS[weather.condition])} {formatTemp(weather.temperature, temperatureUnit)}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="space-y-4 p-4 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('weatherOverride.condition')}</span>
            {weather && (
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                {t('weatherOverride.reset')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {conditions.map((c) => (
              <button
                key={c.value}
                onClick={() =>
                  onChange({
                    temperature: weather?.temperature ?? 20,
                    condition: c.value,
                  })
                }
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                  weather?.condition === c.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted bg-background hover:border-primary/50'
                )}
              >
                {c.icon}
                <span className="text-sm">{tc(OVERRIDE_CONDITION_KEYS[c.value])}</span>
              </button>
            ))}
          </div>
          {weather && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{t('weatherOverride.temperature')}</span>
              <input
                type="range"
                min={temperatureUnit === 'fahrenheit' ? 14 : -10}
                max={temperatureUnit === 'fahrenheit' ? 104 : 40}
                value={temperatureUnit === 'fahrenheit' ? Math.round(toF(weather.temperature)) : weather.temperature}
                onChange={(e) => {
                  const raw = parseInt(e.target.value);
                  onChange({ ...weather, temperature: temperatureUnit === 'fahrenheit' ? Math.round(toCelsius(raw)) : raw });
                }}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-medium w-14 text-right">{formatTemp(weather.temperature, temperatureUnit)}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OutfitCard({
  outfit,
  baseItemIds,
  temperatureUnit,
  t,
  onAccept,
  onReject,
  onWearToday,
  onSwapItem,
  showActions = true,
  badgeLabel,
}: {
  outfit: Outfit;
  baseItemIds: Set<string>;
  temperatureUnit: TempUnit;
  t: Translator;
  onAccept?: () => void;
  onReject?: () => void;
  // Fork: choose the look and log it as worn today in one tap.
  onWearToday?: () => void;
  onSwapItem?: (item: OutfitItem) => void;
  showActions?: boolean;
  badgeLabel?: string;
}) {
  const typeLabel = useTypeLabel();
  const tSwap = useTranslations('smartSuggest.swap');
  const tLog = useTranslations('quickLog');
  return (
    <Card className="overflow-hidden flex flex-col h-full">
      <div className="bg-secondary p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
            <h3 className="font-serif text-lg truncate">
              {outfit.reasoning || (badgeLabel ?? t('yourOutfit'))}
            </h3>
          </div>
          {badgeLabel && (
            <Badge variant="secondary" className="text-xs px-2 py-0.5 flex-shrink-0">
              {badgeLabel}
            </Badge>
          )}
        </div>
        {outfit.highlights && outfit.highlights.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {outfit.highlights.map((highlight, index) => (
              <li key={index} className="flex items-start gap-2 text-xs sm:text-sm text-muted-foreground">
                <span className="text-primary mt-0.5">•</span>
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {outfit.items.map((item) => {
            const isBase = baseItemIds.has(item.id);
            return (
              <Link
                key={item.id}
                href={`/dashboard/wardrobe?item=${item.id}`}
                className={cn(
                  'group relative rounded-xl border overflow-hidden bg-muted/30 hover:shadow-md transition-all',
                  isBase && 'border-primary/60 ring-2 ring-primary/20'
                )}
              >
                <div className="aspect-square relative">
                  {isBase && (
                    <Badge className="absolute top-2 left-2 z-10 bg-primary/95 text-primary-foreground text-[10px] px-2 py-0.5 shadow-sm">
                      {t('baseItem.basePiece')}
                    </Badge>
                  )}
                  {onSwapItem && !isBase && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSwapItem(item);
                      }}
                      className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-full bg-background/90 border px-2 py-0.5 text-[10px] font-medium shadow-sm opacity-90 hover:opacity-100 hover:border-primary/60"
                      aria-label={tSwap('title', { item: item.name || typeLabel(item.type) })}
                      data-testid="swap-item"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {tSwap('button')}
                    </button>
                  )}
                  {item.thumbnail_url ? (
                    <Image
                      src={item.thumbnail_url}
                      alt={item.name || typeLabel(item.type)}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                      sizes="(max-width: 640px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <Shirt className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs sm:text-sm font-medium truncate">
                    {item.name || typeLabel(item.type)}
                  </p>
                  {item.layer_type && (
                    <Badge variant="secondary" className="text-[10px] capitalize mt-0.5">
                      {item.layer_type}
                    </Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {outfit.style_notes && (
          <div className="p-2.5 bg-muted/60 rounded-lg border text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{t('tip')}</span> {outfit.style_notes}
          </div>
        )}

        {showActions && (
          <div className="pt-2 flex gap-2 justify-end border-t mt-auto">
            {onReject && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onReject}
                className="h-8 px-2.5 text-muted-foreground hover:text-destructive"
                aria-label={t('dismissOutfit')}
              >
                <ThumbsDown className="h-4 w-4" />
              </Button>
            )}
            {onWearToday && (
              <Button size="sm" variant="outline" onClick={onWearToday} className="gap-1.5 text-xs h-8">
                <CalendarCheck className="h-3.5 w-3.5" />
                {tLog('wearToday')}
              </Button>
            )}
            {onAccept && (
              <Button size="sm" onClick={onAccept} className="gap-1.5 text-xs h-8">
                <ThumbsUp className="h-3.5 w-3.5" />
                {t('options.chooseThis')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutfitResultsView({
  outfits,
  occasion,
  temperatureUnit,
  baseItemIds,
  activeOptionIndex,
  onSelectOption,
  isCompareAll,
  onToggleCompareAll,
  onAccept,
  onReject,
  onWearToday,
  onTryAnother,
  onNewRequest,
  onSwapItem,
  t,
}: {
  outfits: Outfit[];
  occasion: string;
  temperatureUnit: TempUnit;
  baseItemIds: Set<string>;
  activeOptionIndex: number;
  onSelectOption: (index: number) => void;
  isCompareAll: boolean;
  onToggleCompareAll: () => void;
  onAccept: (outfit?: Outfit) => void;
  onReject: (outfit?: Outfit) => void;
  onWearToday: (outfit: Outfit) => void;
  onTryAnother: () => void;
  onNewRequest: () => void;
  onSwapItem: (outfit: Outfit, item: OutfitItem) => void;
  t: Translator;
}) {
  const locale = useLocale();
  const conditionLabel = useWeatherConditionLabel();
  const occasionLabel = useOccasionLabel();
  const currentOutfit = outfits[activeOptionIndex] || outfits[0];
  const tLog = useTranslations('quickLog');

  return (
    <div className="space-y-6">
      {/* Header with occasion and start over */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {occasionLabel(occasion)}
          </Badge>
          {currentOutfit?.scheduled_for && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {formatShortDate(currentOutfit.scheduled_for, locale)}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onNewRequest}>
          {t('startOver')}
        </Button>
      </div>

      {/* Weather info */}
      {currentOutfit?.weather && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-1.5">
            <Thermometer className="h-4 w-4" />
            <span>{formatTemp(currentOutfit.weather.temperature, temperatureUnit)}</span>
            <span className="text-xs opacity-70">{t('weather.feelsLikeInline', { temp: displayValue(currentOutfit.weather.feels_like, temperatureUnit) })}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Droplets className="h-4 w-4" />
            <span>{t('weather.rainChance', { chance: currentOutfit.weather.precipitation_chance })}</span>
          </div>
          <Badge variant="outline">
            {conditionLabel(currentOutfit.weather.condition)}
          </Badge>
        </div>
      )}

      {/* Options Switcher Bar (when multiple outfits exist) */}
      {outfits.length > 1 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-1.5 bg-muted/60 rounded-xl border">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            {outfits.map((opt, idx) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectOption(idx)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 flex-shrink-0',
                  !isCompareAll && activeOptionIndex === idx
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                )}
              >
                <Sparkles className={cn("h-3.5 w-3.5", !isCompareAll && activeOptionIndex === idx ? "text-primary" : "opacity-40")} />
                <span>{t('options.optionNumber', { number: idx + 1 })}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 pt-1.5 sm:pt-0 border-t sm:border-t-0 justify-end">
            <Button
              variant={isCompareAll ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onToggleCompareAll}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{isCompareAll ? t('options.singleView') : t('options.allOptions')}</span>
            </Button>
          </div>
        </div>
      )}

      {/* View: All Outfits Side-by-Side Grid */}
      {isCompareAll ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {outfits.map((opt, idx) => (
              <OutfitCard
                key={opt.id}
                outfit={opt}
                baseItemIds={baseItemIds}
                temperatureUnit={temperatureUnit}
                t={t}
                badgeLabel={t('options.optionNumber', { number: idx + 1 })}
                onAccept={() => onAccept(opt)}
                onReject={() => onReject(opt)}
                onWearToday={() => onWearToday(opt)}
                onSwapItem={(item) => onSwapItem(opt, item)}
                showActions={true}
              />
            ))}
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <Button variant="outline" size="lg" onClick={onTryAnother} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('options.generateNew')}
            </Button>
          </div>
        </div>
      ) : (
        /* View: Single Active Outfit Focus */
        <div className="space-y-6">
          <OutfitCard
            outfit={currentOutfit}
            baseItemIds={baseItemIds}
            temperatureUnit={temperatureUnit}
            t={t}
            onSwapItem={(item) => onSwapItem(currentOutfit, item)}
            badgeLabel={outfits.length > 1 ? t('options.optionNumber', { number: activeOptionIndex + 1 }) : undefined}
            onAccept={() => onAccept(currentOutfit)}
            onReject={() => onReject(currentOutfit)}
            showActions={false}
          />

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 justify-center">
            <Button variant="outline" size="lg" onClick={onTryAnother} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {outfits.length > 1 ? t('options.generateNew') : t('tryAnother')}
            </Button>
            <Button size="lg" onClick={() => onAccept(currentOutfit)} className="gap-2">
              <ThumbsUp className="h-4 w-4" />
              {t('loveIt')}
            </Button>
            <Button variant="outline" size="lg" onClick={() => onWearToday(currentOutfit)} className="gap-2">
              <CalendarCheck className="h-4 w-4" />
              {tLog('wearToday')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => onReject(currentOutfit)} className="px-3" aria-label={t('dismissOutfit')}>
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// suggest-options materialises all three looks up front, so any the user walks away from
// would otherwise sit in history as pending forever.
async function discardAlternatives(outfits: Outfit[], keepId?: string) {
  await Promise.allSettled(
    outfits
      .filter((o) => o.id !== keepId)
      .map((o) => api.post(`/outfits/${o.id}/skip`))
  );
}

function SuggestContent() {
  const t = useTranslations('suggest');
  const tLog = useTranslations('quickLog');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const preselectedItemId = searchParams.get('item');
  const { data: preselectedItem } = useItem(preselectedItemId || '');
  const { data: session } = useSession();
  const { data: weather, isLoading: weatherLoading } = useWeather();
  const { data: prefs } = usePreferences();
  const temperatureUnit: TempUnit = prefs?.temperature_unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const [selectedOccasion, setSelectedOccasion] = useState<string | null>(null);
  const [occasionInitialized, setOccasionInitialized] = useState(false);
  const [weatherOverride, setWeatherOverride] = useState<WeatherOverride | null>(null);
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [filters, setFilters] = useState<OutfitFilters>(EMPTY_FILTERS);
  const [swapTarget, setSwapTarget] = useState<{ outfit: Outfit; item: OutfitItem } | null>(null);
  const { data: features } = useFeatures();
  const [isGenerating, setIsGenerating] = useState(false);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number>(0);
  const [isCompareAll, setIsCompareAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedItem && selectedItems.length === 0) {
      setSelectedItems([preselectedItem]);
    }
    // Only the preselected item from the URL seeds the list, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedItem]);

  useEffect(() => {
    if (prefs?.default_occasion && !occasionInitialized && !selectedOccasion) {
      setSelectedOccasion(prefs.default_occasion);
      setOccasionInitialized(true);
    }
  }, [prefs, occasionInitialized, selectedOccasion]);

  const handleGenerate = async () => {
    if (!selectedOccasion) return;

    applySessionToken(session);

    setIsGenerating(true);
    setError(null);

    try {
      const request: SuggestRequest & { filters?: Partial<OutfitFilters> } = {
        occasion: selectedOccasion,
        include_items: selectedItems.map((i) => i.id),
      };
      if (features?.outfit_filters) {
        request.filters = toRequestFilters(filters);
      }

      if (weatherOverride) {
        request.weather_override = {
          temperature: weatherOverride.temperature,
          feels_like: weatherOverride.temperature,
          humidity: 50,
          precipitation_chance: weatherOverride.condition === 'rainy' ? 80 : weatherOverride.condition === 'cloudy' ? 30 : 10,
          condition: weatherOverride.condition,
        };
      }

      const result = await api.post<Outfit[]>('/outfits/suggest-options', request);
      setOutfits(result);
      setActiveOptionIndex(0);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('error'));
      }
      console.error('Suggestion error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = async (targetOutfit?: Outfit) => {
    const outfitToAccept = targetOutfit || outfits[activeOptionIndex];
    if (!outfitToAccept) return;

    applySessionToken(session);

    try {
      await api.post(`/outfits/${outfitToAccept.id}/accept`);
      // Every look was already persisted, so the ones left over are marked skipped rather
      // than rejected: rejecting would auto-exclude their items from today's suggestions,
      // and those items mostly overlap with the outfit just accepted.
      await discardAlternatives(outfits, outfitToAccept.id);
      setOutfits([]);
      setSelectedOccasion(null);
    } catch (err) {
      console.error('Accept error:', err);
    }
  };

  // Fork: accept and log as worn today, so the wear counts and history are right at once.
  const handleWearToday = async (outfit: Outfit) => {
    applySessionToken(session);
    try {
      await wearSuggestionToday(outfit.id);
      await discardAlternatives(outfits, outfit.id);
      setOutfits([]);
      setSelectedOccasion(null);
      toast.success(tLog('wornLogged'));
      queryClient.invalidateQueries({ queryKey: queryKeys.outfits.all });
      invalidateEveryItemWearCache(queryClient);
    } catch (err) {
      console.error('Wear today error:', err);
      toast.error(tLog('wornFailed'));
    }
  };

  const handleTryAnother = async () => {
    await discardAlternatives(outfits);
    setOutfits([]);
    handleGenerate();
  };

  const handleReject = async (targetOutfit?: Outfit) => {
    const outfitToReject = targetOutfit || outfits[activeOptionIndex];
    if (!outfitToReject) return;

    applySessionToken(session);

    try {
      await api.post(`/outfits/${outfitToReject.id}/reject`);
    } catch (err) {
      console.error('Reject error:', err);
    }

    const remaining = outfits.filter((o) => o.id !== outfitToReject.id);
    if (remaining.length > 0) {
      setOutfits(remaining);
      setActiveOptionIndex((prev) => Math.min(prev, remaining.length - 1));
    } else {
      setOutfits([]);
      handleGenerate();
    }
  };

  const handleNewRequest = async () => {
    await discardAlternatives(outfits);
    setOutfits([]);
    setActiveOptionIndex(0);
    setIsCompareAll(false);
    setSelectedOccasion(null);
    setError(null);
  };

  return (
    <div
      className={cn(
        "mx-auto space-y-6 transition-all duration-300",
        isCompareAll && outfits.length > 0 ? "max-w-5xl" : "max-w-2xl"
      )}
    >
      {/* Page header with greeting */}
      <div className="text-center space-y-1">
        <h1 className="font-serif text-3xl tracking-tight">{t(getGreetingKey())}</h1>
        <p className="text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {outfits.length === 0 ? (
        <div className="space-y-6">
          {/* Weather context */}
          <WeatherCard weather={weather} isLoading={weatherLoading} temperatureUnit={temperatureUnit} t={t} />

          {/* Main selection card */}
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* Occasion selection */}
              <div className="space-y-3">
                <h2 className="font-semibold">{t('occasionPrompt')}</h2>
                <OccasionChips
                  selected={selectedOccasion}
                  onSelect={setSelectedOccasion}
                  extraOccasions={[prefs?.default_occasion]}
                />
              </div>

              {/* Pinned items (several) */}
              <PinnedItemsPicker items={selectedItems} onChange={setSelectedItems} />

              {features?.outfit_filters && (
                <OutfitFilterPanel
                  filters={filters}
                  onChange={setFilters}
                  hasPinned={selectedItems.length > 0}
                />
              )}

              {/* Weather override (collapsible) */}
              <WeatherOverrideSection
                weather={weatherOverride}
                onChange={setWeatherOverride}
                temperatureUnit={temperatureUnit}
                t={t}
              />

              {/* Generate button */}
              <div className="pt-2">
                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={handleGenerate}
                  disabled={!selectedOccasion || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {t('generating')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      {t('getSuggestion')}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <OutfitResultsView
          outfits={outfits}
          activeOptionIndex={activeOptionIndex}
          onSelectOption={setActiveOptionIndex}
          isCompareAll={isCompareAll}
          onToggleCompareAll={() => setIsCompareAll(!isCompareAll)}
          occasion={selectedOccasion || 'casual'}
          temperatureUnit={temperatureUnit}
          baseItemIds={new Set(selectedItems.map((i) => i.id))}
          onAccept={handleAccept}
          onReject={handleReject}
          onWearToday={handleWearToday}
          onTryAnother={handleTryAnother}
          onNewRequest={handleNewRequest}
          onSwapItem={(outfit, item) => setSwapTarget({ outfit, item })}
          t={t}
        />
      )}

      {swapTarget && (
        <SwapItemDialog
          outfit={swapTarget.outfit}
          item={swapTarget.item}
          onClose={() => setSwapTarget(null)}
          onSwapped={(updated) =>
            setOutfits((current) => current.map((o) => (o.id === updated.id ? updated : o)))
          }
        />
      )}

    </div>
  );
}

export default function SuggestPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-2 text-center">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </div>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      }
    >
      <SuggestContent />
    </Suspense>
  );
}
