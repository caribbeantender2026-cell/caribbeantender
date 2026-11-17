/** Deadlines are stored in UTC and shown in Jamaica time; these helpers convert between the two. */

export const jamaicaTimeZone = 'America/Jamaica';

const millisecondsPerMinute = 60_000;
// ponytail: Jamaica has kept UTC-5 all year since 1983. If it ever brings back daylight saving, derive the
// offset per date from Intl (timeZoneName: 'longOffset') instead of this constant.
const jamaicaUtcOffsetMinutes = -300;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Formats a UTC timestamp in Jamaica time, for example "10 Oct 2026, 5:00 pm". */
export function formatJamaicaDateTime(timestamp: string | Date, options: { withSeconds?: boolean } = {}): string {
  return new Intl.DateTimeFormat('en-JM', {
    timeZone: jamaicaTimeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' } : {}),
  }).format(new Date(timestamp));
}

/**
 * Converts a datetime-local value typed in Jamaica time ("2026-10-10T17:00") to a UTC ISO string.
 * Throws a plain-English error for anything that is not a real date and time in that format.
 */
export function jamaicaLocalToUtc(localDateTime: string): string {
  const match = localDateTimePattern.exec(localDateTime);
  if (!match) {
    throw new Error(`"${localDateTime}" is not a date and time like 2026-10-10T17:00.`);
  }
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  const sameClockInUtc = Date.UTC(year, month - 1, day, hour, minute);
  const checkedClock = new Date(sameClockInUtc);
  // Date.UTC silently rolls invalid values over (31 June becomes 1 July, 25:00 the next day); reject those.
  const rolledOver =
    checkedClock.getUTCMonth() !== month - 1 ||
    checkedClock.getUTCDate() !== day ||
    checkedClock.getUTCHours() !== hour ||
    checkedClock.getUTCMinutes() !== minute;
  if (rolledOver) {
    throw new Error(`"${localDateTime}" is not a real date and time.`);
  }
  return new Date(sameClockInUtc - jamaicaUtcOffsetMinutes * millisecondsPerMinute).toISOString();
}

/** Converts a UTC timestamp to a datetime-local value in Jamaica time, for editing a deadline. */
export function utcToJamaicaLocal(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: jamaicaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const valueOf = (partType: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === partType)?.value ?? '';
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}T${valueOf('hour')}:${valueOf('minute')}`;
}

const millisecondsPerSecond = 1000;
const secondsPerMinute = 60;
const secondsPerHour = 3600;
const secondsPerDay = 86_400;

/** Time left until a moment, for a countdown, for example "2 days 3 hours" or "4 minutes 10 seconds"; null once it has passed. */
export function formatTimeLeft(until: string, now: Date = new Date()): string | null {
  const totalSeconds = Math.floor((new Date(until).getTime() - now.getTime()) / millisecondsPerSecond);
  if (totalSeconds <= 0) {
    return null;
  }
  const days = Math.floor(totalSeconds / secondsPerDay);
  const hours = Math.floor((totalSeconds % secondsPerDay) / secondsPerHour);
  const minutes = Math.floor((totalSeconds % secondsPerHour) / secondsPerMinute);
  const seconds = totalSeconds % secondsPerMinute;
  const unit = (count: number, name: string): string => `${count} ${name}${count === 1 ? '' : 's'}`;
  // The two largest units that matter; seconds only in the last hour, when they do.
  if (days > 0) return `${unit(days, 'day')} ${unit(hours, 'hour')}`;
  if (hours > 0) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
  if (minutes > 0) return `${unit(minutes, 'minute')} ${unit(seconds, 'second')}`;
  return unit(seconds, 'second');
}
