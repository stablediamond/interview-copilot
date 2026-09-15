/** Timezone helpers for the calendar week view. */

export type TimeZoneOption = {
  id: string;
  label: string;
  offsetMinutes: number;
  searchText: string;
};

function pad2(n: number): string {
  return String(Math.abs(n)).padStart(2, "0");
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

export function getTimeZoneOffsetMinutes(
  timeZone: string,
  at: Date = new Date()
): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    });
    const name = dtf
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) return 0;
    if (name === "GMT" || name === "UTC") return 0;
    const match = /(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const mins = Number(match[3] ?? "0");
    return sign * (hours * 60 + mins);
  } catch {
    return 0;
  }
}

export function getTimeZoneAbbreviation(
  timeZone: string,
  at: Date = new Date()
): string | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });
    const name = dtf
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) return null;
    if (/^GMT|^UTC|[+-]\d/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

export function formatTimeZoneLabel(
  timeZone: string,
  at: Date = new Date()
): string {
  const offset = formatUtcOffset(getTimeZoneOffsetMinutes(timeZone, at));
  const abbr = getTimeZoneAbbreviation(timeZone, at);
  if (abbr) return `UTC${offset} (${abbr}) — ${timeZone}`;
  return `UTC${offset} — ${timeZone}`;
}

export function listTimeZoneOptions(at: Date = new Date()): TimeZoneOption[] {
  let ids: string[] = [];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") {
      ids = supported("timeZone");
    }
  } catch {
    ids = [];
  }
  if (ids.length === 0) {
    ids = [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Toronto",
      "Europe/London",
      "Europe/Paris",
      "Asia/Tokyo",
      "Asia/Shanghai",
      "Asia/Kolkata",
      "Australia/Sydney",
    ];
  }

  return ids
    .map((id) => {
      const offsetMinutes = getTimeZoneOffsetMinutes(id, at);
      const label = formatTimeZoneLabel(id, at);
      return {
        id,
        label,
        offsetMinutes,
        searchText: `${label} ${id}`.toLowerCase(),
      };
    })
    .sort((a, b) => {
      if (a.offsetMinutes !== b.offsetMinutes) {
        return a.offsetMinutes - b.offsetMinutes;
      }
      return a.id.localeCompare(b.id);
    });
}
