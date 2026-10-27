'use client';

// Fork: moved from the upstream dashboard, which Wearly's "Oggi" home replaced. Its links now
// point at Settings › Notifiche, where the card lives.
import Link from 'next/link';
import { Bell, BellOff, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotificationSettings } from '@/lib/hooks/use-notifications';

export function NotificationStatusCard() {
  const { data: settings, isLoading } = useNotificationSettings();
  const t = useTranslations('dashboard');

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {t('notifications.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  const channels = settings || [];
  const enabledChannels = channels.filter((c) => c.enabled);

  if (channels.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BellOff className="h-4 w-4 text-muted-foreground" />
            {t('notifications.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">{t('notifications.noChannels')}</p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/settings#notifications">{t('notifications.addChannel')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {t('notifications.title')}
          </CardTitle>
          <Link href="/dashboard/settings#notifications" className="text-xs text-muted-foreground hover:text-foreground">
            {t('notifications.configure')}
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {channels.map((channel) => (
            <Badge
              key={channel.id}
              variant={channel.enabled ? 'default' : 'outline'}
              className={channel.enabled ? '' : 'text-muted-foreground'}
            >
              {channel.enabled ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <XCircle className="h-3 w-3 mr-1" />
              )}
              {channel.channel}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {t('notifications.activeCount', { active: enabledChannels.length, total: channels.length })}
        </p>
      </CardContent>
    </Card>
  );
}
