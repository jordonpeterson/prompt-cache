import type { TimePeriod } from '@/types';

export function getTimePeriod(date: Date): TimePeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 7) return 'Dawn';
  if (hour >= 7 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 14) return 'Midday';
  if (hour >= 14 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 20) return 'Dusk';
  return 'Night';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}
