import { env } from './env';

export function formatAppDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';

  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}

export function appDateTimeFromNow(offsetMs: number) {
  return formatAppDateTime(new Date(Date.now() + offsetMs));
}

export function appDateTime() {
  return formatAppDateTime(new Date());
}
