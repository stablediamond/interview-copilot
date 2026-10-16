export type CalendarEventRange = { start: string; end: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cover the displayed civil week in every time zone, including all-day events
 * stored at UTC midnight. The extra day at each edge also covers DST changes.
 */
export function calendarEventRangeForWeek(
  firstDay: Date,
  timeZone: string,
): CalendarEventRange {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(firstDay);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const midnight = Date.UTC(part("year"), part("month") - 1, part("day"));
  return {
    start: new Date(midnight - DAY_MS).toISOString(),
    end: new Date(midnight + 8 * DAY_MS).toISOString(),
  };
}

export function calendarRangeContains(
  loaded: CalendarEventRange,
  requested: CalendarEventRange,
): boolean {
  return loaded.start <= requested.start && loaded.end >= requested.end;
}

/** Limit each browser query without imposing a cutoff on historical dates. */
export function parseCalendarEventRange(
  start: string | null,
  end: string | null,
): CalendarEventRange | null {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    new Date(from).toISOString() !== start ||
    new Date(to).toISOString() !== end ||
    to <= from ||
    to - from > 31 * DAY_MS
  ) return null;
  return { start, end };
}
