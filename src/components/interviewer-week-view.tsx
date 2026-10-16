"use client";

import * as React from "react";
import Link from "next/link";
import { Mic } from "lucide-react";
import { CalendarDatePicker } from "@/components/calendar-date-picker";
import { TimeZonePicker } from "@/components/timezone-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEventView } from "@/lib/calendar-types";
import {
  calendarEventRangeForWeek,
  calendarRangeContains,
  type CalendarEventRange,
} from "@/lib/calendar-event-range";
import {
  HOUR_END,
  HOUR_HEIGHT,
  HOUR_START,
  TIME_GUTTER,
  addDays,
  applicationLabel,
  dayHeaderParts,
  detectDefaultTimeZone,
  eventMinutesInDay,
  eventStyle,
  formatHourLabel,
  formatRangeLabel,
  layoutDayEvents,
  personName,
  startOfWeek,
  zonedDateKey,
} from "@/lib/calendar-layout";
import styles from "./calendar-week-view.module.css";

const INITIAL_SCROLL_HOUR = 8;

const hours = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i
);

function formatMinuteLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0
    ? `${hour12}${suffix}`
    : `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function InterviewerWeekView({
  events: initialEvents,
  initialEventRange,
  jobTrackUrl,
  applicationBasePath,
  onRangeNeeded,
}: {
  events: CalendarEventView[];
  initialEventRange: CalendarEventRange;
  jobTrackUrl: string;
  applicationBasePath: string;
  /** Load more events when the visible week is outside the loaded range. */
  onRangeNeeded?: (range: CalendarEventRange) => Promise<{
    events: CalendarEventView[];
    range: CalendarEventRange;
  }>;
}) {
  const [timeZone, setTimeZone] = React.useState(detectDefaultTimeZone);
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [eventList, setEventList] = React.useState(initialEvents);
  const [loadedRange, setLoadedRange] = React.useState(initialEventRange);
  const [loadingEvents, setLoadingEvents] = React.useState(false);
  const [eventsError, setEventsError] = React.useState<string | null>(null);
  const [eventsRetry, setEventsRetry] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const [clockReady, setClockReady] = React.useState(false);
  const calendarScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setEventList(initialEvents);
    setLoadedRange(initialEventRange);
  }, [initialEvents, initialEventRange]);

  React.useEffect(() => {
    setTimeZone(detectDefaultTimeZone());
    setNow(new Date());
    setClockReady(true);
  }, []);

  React.useEffect(() => {
    if (!clockReady || !calendarScrollRef.current) return;
    calendarScrollRef.current.scrollTop =
      (INITIAL_SCROLL_HOUR - HOUR_START) * HOUR_HEIGHT;
  }, [clockReady, timeZone]);

  React.useEffect(() => {
    if (!clockReady) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [clockReady]);

  const weekStart = React.useMemo(
    () => startOfWeek(anchor, timeZone),
    [anchor, timeZone]
  );
  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const rangeLabel = React.useMemo(
    () => formatRangeLabel(days[0], days[6], timeZone),
    [days, timeZone]
  );
  const todayKey = React.useMemo(
    () => zonedDateKey(now, timeZone),
    [now, timeZone]
  );
  const neededRange = React.useMemo(
    () => calendarEventRangeForWeek(days[0], timeZone),
    [days, timeZone]
  );

  React.useEffect(() => {
    if (!onRangeNeeded) return;
    if (calendarRangeContains(loadedRange, neededRange)) return;
    let cancelled = false;
    setLoadingEvents(true);
    setEventsError(null);
    void (async () => {
      try {
        const result = await onRangeNeeded(neededRange);
        if (cancelled) return;
        setEventList(result.events);
        setLoadedRange(result.range);
      } catch (err) {
        if (!cancelled) {
          setEventsError(
            err instanceof Error ? err.message : "Could not load calendar."
          );
        }
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedRange, neededRange, onRangeNeeded, eventsRetry]);

  const nowMarker = React.useMemo(() => {
    if (!clockReady) return null;
    const parts = (() => {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const get = (type: string) =>
        dtf.formatToParts(now).find((p) => p.type === type)?.value ?? "0";
      return {
        hour: Number(get("hour")),
        minute: Number(get("minute")),
        second: Number(get("second")),
      };
    })();
    const dayIndex = days.findIndex(
      (d) => zonedDateKey(d, timeZone) === todayKey
    );
    if (dayIndex < 0) return null;
    const minutes = parts.hour * 60 + parts.minute + parts.second / 60;
    return { dayIndex, top: (minutes / 60) * HOUR_HEIGHT };
  }, [clockReady, days, now, timeZone, todayKey]);

  const dayLayouts = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutDayEvents>>();
    for (const day of days) {
      const key = zonedDateKey(day, timeZone);
      map.set(key, layoutDayEvents(eventList, key, timeZone));
    }
    return map;
  }, [days, eventList, timeZone]);

  const selected = eventList.find((e) => e.id === selectedId) ?? null;

  return (
    <div className={styles.calendar}>
      <div className={styles.toolbar}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setAnchor(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setAnchor(addDays(weekStart, 7))}
          >
            ›
          </button>
          <CalendarDatePicker
            label={rangeLabel}
            selected={anchor}
            weekStart={days[0]}
            weekEnd={days[6]}
            timeZone={timeZone}
            onSelect={setAnchor}
          />
        </div>
        <TimeZonePicker value={timeZone} onChange={setTimeZone} />
      </div>

      {loadingEvents ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading events…
        </p>
      ) : null}
      {eventsError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {eventsError}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setEventsRetry((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.main}>
          <div
            ref={calendarScrollRef}
            data-calendar-scroll
            className={styles.scroll}
          >
            <div className={styles.sheet}>
              <div data-calendar-header className={styles.stickyHeader}>
                <div
                  className={styles.dayHeaders}
                  style={{
                    gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
                  }}
                >
                  <div className={styles.headerGutter} />
                  {days.map((day) => {
                    const key = zonedDateKey(day, timeZone);
                    const isToday = key === todayKey;
                    const { dayNum, weekday } = dayHeaderParts(day, timeZone);
                    return (
                      <div
                        key={key}
                        className={`${styles.dayHeader} ${isToday ? styles.today : ""}`}
                        aria-current={isToday ? "date" : undefined}
                      >
                        <p className={styles.dayNumber}>{dayNum}</p>
                        <p className={styles.weekday}>{weekday}</p>
                      </div>
                    );
                  })}
                </div>

                <div
                  className={styles.allDayRow}
                  style={{
                    gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
                  }}
                >
                  <div className={styles.allDayLabel}>All day</div>
                  {days.map((day) => {
                    const key = zonedDateKey(day, timeZone);
                    return (
                      <div
                        key={key}
                        className={`${styles.allDayCell} ${key === todayKey ? styles.today : ""}`}
                      >
                        {eventList
                          .filter(
                            (event) =>
                              event.all_day &&
                              eventMinutesInDay(event, key, timeZone)
                          )
                          .map((event) => (
                            <button
                              key={event.id}
                              type="button"
                              data-all-day-event
                              title={event.title}
                              aria-label={`${event.title}, all day`}
                              className={`${styles.event} ${styles.allDayEvent} ${selectedId === event.id ? styles.selectedEvent : ""}`}
                              style={eventStyle(event.source_color)}
                              onClick={() => setSelectedId(event.id)}
                            >
                              <span className={styles.eventTitle}>
                                {event.title}
                              </span>
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className={styles.timeGrid}
                style={{
                  gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
                }}
              >
                <div className={styles.timeGutter}>
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className={styles.timeLabel}
                      style={{ height: HOUR_HEIGHT }}
                    >
                      <span>{formatHourLabel(hour)}</span>
                    </div>
                  ))}
                </div>

                {days.map((day, dayIndex) => {
                  const dayKey = zonedDateKey(day, timeZone);
                  const laidOut = dayLayouts.get(dayKey) ?? [];
                  const nowKind =
                    nowMarker == null
                      ? null
                      : dayIndex < nowMarker.dayIndex
                        ? "past"
                        : dayIndex === nowMarker.dayIndex
                          ? "today"
                          : null;
                  return (
                    <div
                      key={dayKey}
                      data-day-column
                      className={`${styles.dayColumn} ${dayKey === todayKey ? styles.today : ""}`}
                      style={{
                        height: (HOUR_END - HOUR_START) * HOUR_HEIGHT,
                      }}
                    >
                      {hours.map((hour) => (
                        <div
                          key={hour}
                          data-hour-slot
                          className={styles.hourSlot}
                          style={{ height: HOUR_HEIGHT }}
                        />
                      ))}
                      {laidOut.map((item) => {
                        const widthPct = 100 / item.cols;
                        const leftPct = item.col * widthPct;
                        const color = item.event.source_color || "#0078d4";
                        const selectedEvent = selectedId === item.event.id;
                        const startMin = Math.round(
                          (item.top / HOUR_HEIGHT) * 60
                        );
                        const endMin = Math.round(
                          ((item.top + item.height) / HOUR_HEIGHT) * 60
                        );
                        return (
                          <button
                            key={`${item.event.id}-${dayKey}`}
                            type="button"
                            data-calendar-event
                            title={`${item.event.title} — ${formatMinuteLabel(startMin)}–${formatMinuteLabel(endMin)}`}
                            aria-label={`${item.event.title}, ${formatMinuteLabel(startMin)}–${formatMinuteLabel(endMin)}`}
                            onClick={() => setSelectedId(item.event.id)}
                            className={`${styles.event} ${styles.timedEvent} ${item.height <= HOUR_HEIGHT / 2 ? styles.shortEvent : ""} ${item.height <= HOUR_HEIGHT / 4 ? styles.tinyEvent : ""} ${selectedEvent ? styles.selectedEvent : ""}`}
                            style={{
                              top: item.top + 2,
                              height: Math.max(2, item.height - 4),
                              left: `calc(${leftPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              ...eventStyle(color),
                            }}
                          >
                            <span className={styles.eventTitle}>
                              {item.event.title}
                            </span>
                            {item.height >= HOUR_HEIGHT &&
                            item.event.location ? (
                              <span className={styles.eventLocation}>
                                {item.event.location}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}

                      {nowKind && nowMarker ? (
                        <div
                          data-current-time-marker={nowKind}
                          className="pointer-events-none absolute inset-x-0 z-[2]"
                          style={{ top: nowMarker.top }}
                          aria-hidden
                        >
                          <div className="relative h-0">
                            {nowKind === "today" ? (
                              <>
                                <div className={styles.nowDot} />
                                <div className={styles.nowLine} />
                              </>
                            ) : (
                              <div
                                className={styles.pastLine}
                                style={{ height: 0 }}
                              />
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className={`max-w-xl ${styles.calendar}`}>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
                <DialogDescription>
                  {selected.all_day
                    ? `${selected.starts_at.slice(0, 10)} (all day)`
                    : `${new Date(selected.starts_at).toLocaleString(undefined, {
                        timeZone,
                        dateStyle: "full",
                        timeStyle: "short",
                      })} – ${new Date(selected.ends_at).toLocaleTimeString(
                        undefined,
                        { timeZone, timeStyle: "short" }
                      )}`}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Source
                  </dt>
                  <dd className="mt-0.5 flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-sm"
                      style={{
                        backgroundColor: selected.source_color || "#0078d4",
                      }}
                    />
                    {selected.source_label}
                  </dd>
                </div>
                {selected.interviewer_id ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Assigned to
                    </dt>
                    <dd className="mt-0.5">
                      {personName(
                        selected.interviewer_firstname,
                        selected.interviewer_lastname,
                        selected.interviewer_email
                      )}
                    </dd>
                  </div>
                ) : null}
                {selected.candidate_id ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Candidate
                    </dt>
                    <dd className="mt-0.5">
                      {personName(
                        selected.candidate_firstname,
                        selected.candidate_lastname,
                        selected.candidate_email
                      )}
                    </dd>
                  </div>
                ) : null}
                {selected.location ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Location
                    </dt>
                    <dd className="mt-0.5">{selected.location}</dd>
                  </div>
                ) : null}
                {selected.description ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Description
                    </dt>
                    <dd className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">
                      {selected.description}
                    </dd>
                  </div>
                ) : null}
                {selected.linked_applications.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Applications
                    </dt>
                    <dd className="mt-1 flex flex-col gap-1">
                      {selected.linked_applications.map((app) => {
                        const href = `${jobTrackUrl.replace(/\/$/, "")}${applicationBasePath}/${encodeURIComponent(app.job_id)}?candidateId=${encodeURIComponent(app.candidate_id)}`;
                        return (
                          <a
                            key={app.application_id}
                            className="text-sm text-primary underline underline-offset-2"
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {applicationLabel(app.role, app.company)}
                          </a>
                        );
                      })}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="flex justify-end border-t border-border pt-4">
                <Button asChild>
                  <Link
                    href={`/session?eventId=${encodeURIComponent(selected.id)}`}
                  >
                    <Mic className="h-4 w-4" /> Start session
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
