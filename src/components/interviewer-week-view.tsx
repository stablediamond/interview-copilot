"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TimeZonePicker } from "@/components/timezone-picker";
import type { CalendarEventView } from "@/lib/calendar-types";
import {
  HOUR_END,
  HOUR_HEIGHT,
  HOUR_START,
  TIME_GUTTER,
  addDays,
  dayHeaderParts,
  detectDefaultTimeZone,
  eventStyle,
  formatHourLabel,
  formatRangeLabel,
  layoutDayEvents,
  personName,
  startOfWeek,
  zonedDateKey,
} from "@/lib/calendar-layout";

const hours = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i
);

export function InterviewerWeekView({
  events,
}: {
  events: CalendarEventView[];
}) {
  const [timeZone, setTimeZone] = React.useState(detectDefaultTimeZone);
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const [clockReady, setClockReady] = React.useState(false);

  React.useEffect(() => {
    setTimeZone(detectDefaultTimeZone());
    setNow(new Date());
    setClockReady(true);
  }, []);

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
      map.set(key, layoutDayEvents(events, key, timeZone));
    }
    return map;
  }, [days, events, timeZone]);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setAnchor(addDays(weekStart, -7))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setAnchor(addDays(weekStart, 7))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold">{rangeLabel}</p>
        </div>
        <TimeZonePicker value={timeZone} onChange={setTimeZone} />
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-card"
          style={{
            gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
          }}
        >
          <div className="border-r border-border" />
          {days.map((day) => {
            const key = zonedDateKey(day, timeZone);
            const isToday = key === todayKey;
            const { dayNum, weekday } = dayHeaderParts(day, timeZone);
            return (
              <div
                key={key}
                className="border-r border-border px-3 py-2 text-left last:border-r-0"
              >
                <p
                  className={`text-2xl font-semibold leading-none tracking-tight ${
                    isToday ? "text-primary" : ""
                  }`}
                >
                  {dayNum}
                </p>
                <p
                  className={`mt-1 text-xs font-medium ${
                    isToday ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {weekday}
                </p>
              </div>
            );
          })}
        </div>

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_GUTTER} repeat(7, minmax(0, 1fr))`,
          }}
        >
          <div className="relative border-r border-border">
            {hours.map((hour) => (
              <div
                key={hour}
                className="border-b border-border/60 pr-2 text-right text-xs text-muted-foreground"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="-translate-y-2 block font-medium">
                  {formatHourLabel(hour)}
                </span>
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
                className="relative border-r border-border last:border-r-0"
                style={{ height: (HOUR_END - HOUR_START) * HOUR_HEIGHT }}
              >
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="border-b border-dashed border-border/70"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {laidOut.map((item) => {
                  const widthPct = 100 / item.cols;
                  const leftPct = item.col * widthPct;
                  const color = item.event.source_color || "#6366f1";
                  const selectedEvent = selectedId === item.event.id;
                  return (
                    <button
                      key={`${item.event.id}-${dayKey}`}
                      type="button"
                      title={item.event.title}
                      onClick={() => setSelectedId(item.event.id)}
                      className={`absolute z-[1] cursor-pointer overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight ${
                        selectedEvent ? "ring-2 ring-ring" : ""
                      }`}
                      style={{
                        top: item.top,
                        height: item.height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        ...eventStyle(color, selectedEvent),
                      }}
                    >
                      <span className="line-clamp-3 font-semibold">
                        {item.event.title}
                      </span>
                    </button>
                  );
                })}

                {nowKind && nowMarker ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[2]"
                    style={{ top: nowMarker.top }}
                    aria-hidden
                  >
                    <div className="relative h-0">
                      {nowKind === "today" ? (
                        <>
                          <div className="absolute left-0 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
                          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary" />
                        </>
                      ) : (
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-primary" />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-w-xl">
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
                        backgroundColor: selected.source_color || "#6366f1",
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
