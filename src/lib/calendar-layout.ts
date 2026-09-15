import type { CSSProperties } from "react";
import type { CalendarEventView } from "./calendar-types";

export const HOUR_START = 0;
export const HOUR_END = 24;
export const HOUR_HEIGHT = 66;
export const TIME_GUTTER = "4.5rem";
export const FALLBACK_TZ = "UTC";

export type LaidOutEvent = {
  event: CalendarEventView;
  top: number;
  height: number;
  col: number;
  cols: number;
};

export function detectDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

export function startOfWeek(date: Date, timeZone: string): Date {
  const parts = getZonedParts(date, timeZone);
  const day = parts.weekday;
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - day, 12, 0, 0)
  );
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

export function zonedDateKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function dayHeaderParts(
  date: Date,
  timeZone: string
): { dayNum: string; weekday: string } {
  const dayNum = new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: "numeric",
  }).format(date);
  const weekday = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
  }).format(date);
  return { dayNum, weekday };
}

export function formatRangeLabel(
  start: Date,
  end: Date,
  timeZone: string
): string {
  const startParts = getZonedParts(start, timeZone);
  const endParts = getZonedParts(end, timeZone);
  const monthName = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "long",
  }).format(start);

  if (
    startParts.year === endParts.year &&
    startParts.month === endParts.month
  ) {
    return `${monthName} ${startParts.day}–${endParts.day}, ${startParts.year}`;
  }

  const startFmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(start);
  const endFmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `${startFmt} – ${endFmt}`;
}

export function personName(
  firstname: string | null | undefined,
  lastname: string | null | undefined,
  email: string | null | undefined
): string {
  const name = [firstname, lastname].filter(Boolean).join(" ").trim();
  return name || email || "—";
}

export function applicationLabel(role: string, company: string): string {
  return [role, company].filter(Boolean).join(" at ") || "Application";
}

function eventMinutesInDay(
  event: CalendarEventView,
  dayKey: string,
  timeZone: string
): { startMin: number; endMin: number } | null {
  if (event.all_day) {
    const startKey = event.starts_at.slice(0, 10);
    const endExclusive = event.ends_at.slice(0, 10);
    if (dayKey < startKey || dayKey >= endExclusive) return null;
    return { startMin: 0, endMin: 60 };
  }

  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const startParts = getZonedParts(start, timeZone);
  const endParts = getZonedParts(end, timeZone);
  const startKey = zonedDateKey(start, timeZone);
  const endKey = zonedDateKey(end, timeZone);

  if (dayKey < startKey || dayKey > endKey) return null;

  let startMin = 0;
  let endMin = 24 * 60;

  if (dayKey === startKey) {
    startMin = startParts.hour * 60 + startParts.minute;
  }
  if (dayKey === endKey) {
    endMin = endParts.hour * 60 + endParts.minute;
    if (endMin === 0 && dayKey > startKey) return null;
    if (endMin <= startMin) endMin = startMin + 30;
  }

  return { startMin, endMin };
}

export function layoutDayEvents(
  events: CalendarEventView[],
  dayKey: string,
  timeZone: string
): LaidOutEvent[] {
  const positioned = events
    .map((event) => {
      const mins = eventMinutesInDay(event, dayKey, timeZone);
      if (!mins) return null;
      const top = (mins.startMin / 60) * HOUR_HEIGHT;
      const height = Math.max(
        ((mins.endMin - mins.startMin) / 60) * HOUR_HEIGHT,
        10
      );
      return { event, top, height, startMin: mins.startMin, endMin: mins.endMin };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        b.endMin - a.endMin ||
        a.event.id.localeCompare(b.event.id)
    );

  if (positioned.length === 0) return [];

  type Node = (typeof positioned)[number] & { col: number };
  const nodes: Node[] = [];
  const colEnds: number[] = [];

  for (const item of positioned) {
    let col = colEnds.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.endMin);
    } else {
      colEnds[col] = item.endMin;
    }
    nodes.push({ ...item, col });
  }

  const result: LaidOutEvent[] = nodes.map((n) => ({
    event: n.event,
    top: n.top,
    height: n.height,
    col: n.col,
    cols: 1,
  }));

  for (let i = 0; i < nodes.length; i++) {
    const visited = new Set<number>();
    const stack = [i];
    let maxCol = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);
      maxCol = Math.max(maxCol, nodes[idx].col);
      for (let j = 0; j < nodes.length; j++) {
        if (visited.has(j)) continue;
        const a = nodes[idx];
        const b = nodes[j];
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          stack.push(j);
        }
      }
    }
    for (const idx of visited) {
      result[idx].cols = Math.max(result[idx].cols, maxCol + 1);
    }
  }

  return result;
}

export function eventStyle(
  color: string,
  selected: boolean
): CSSProperties {
  const bg = hexToRgba(color, selected ? 0.42 : 0.28);
  return {
    backgroundColor: bg,
    borderColor: color,
    borderLeftWidth: 3,
    borderLeftColor: color,
    color: "inherit",
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return `rgba(99, 102, 241, ${alpha})`;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
