"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./calendar-controls.module.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function civilDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
}

export function CalendarDatePicker({
  label,
  selected,
  weekStart,
  weekEnd,
  timeZone,
  onSelect,
}: {
  label: string;
  selected: Date;
  weekStart: Date;
  weekEnd: Date;
  timeZone: string;
  onSelect: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedParts = useMemo(() => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = dtf.formatToParts(selected);
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0");
    return { year: get("year"), month: get("month"), day: get("day") };
  }, [selected, timeZone]);

  const [viewYear, setViewYear] = useState(selectedParts.year);
  const [viewMonth, setViewMonth] = useState(selectedParts.month);

  useEffect(() => {
    if (open) {
      setViewYear(selectedParts.year);
      setViewMonth(selectedParts.month);
    }
  }, [open, selectedParts.year, selectedParts.month]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const weekStartKey = useMemo(() => {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return {
      start: dtf.format(weekStart),
      end: dtf.format(weekEnd),
    };
  }, [weekStart, weekEnd, timeZone]);

  const todayKey = useMemo(() => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }, [timeZone]);

  const selectedKey = `${selectedParts.year}-${String(selectedParts.month).padStart(2, "0")}-${String(selectedParts.day).padStart(2, "0")}`;

  const weeks = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth);
    const start = startWeekday(viewYear, viewMonth);
    const list: Array<{ key: string; day: number; date: Date } | null> = [];
    for (let i = 0; i < start; i++) list.push(null);
    for (let d = 1; d <= total; d++) {
      const date = civilDate(viewYear, viewMonth, d);
      const key = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      list.push({ key, day: d, date });
    }
    while (list.length % 7 !== 0) list.push(null);
    const rows: (typeof list)[] = [];
    for (let i = 0; i < list.length; i += 7) {
      rows.push(list.slice(i, i + 7));
    }
    return rows;
  }, [viewYear, viewMonth]);

  function isInSelectedWeek(key: string): boolean {
    return key >= weekStartKey.start && key <= weekStartKey.end;
  }

  return (
    <div ref={rootRef} className={`${styles.root} relative`}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span aria-hidden className="text-xs opacity-70">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose date"
          className={styles.popover}
        >
          <div className="min-w-0">
            <div className={styles.heading}>
              <button
                type="button"
                className={styles.arrow}
                onClick={() => {
                  if (viewMonth === 1) {
                    setViewMonth(12);
                    setViewYear((y) => y - 1);
                  } else setViewMonth((m) => m - 1);
                }}
                aria-label="Previous month"
              >
                ‹
              </button>
              <p className="font-semibold">
                {MONTHS[viewMonth - 1]} {viewYear}
              </p>
              <button
                type="button"
                className={styles.arrow}
                onClick={() => {
                  if (viewMonth === 12) {
                    setViewMonth(1);
                    setViewYear((y) => y + 1);
                  } else setViewMonth((m) => m + 1);
                }}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
            <div className={styles.weekdays}>
              {WEEKDAYS.map((d) => (
                <div key={d} className="font-normal">
                  {d}
                </div>
              ))}
            </div>
            <div>
              {weeks.map((row, rowIdx) => {
                return (
                  <div key={rowIdx} className={styles.week}>
                    {row.map((cell, idx) => {
                      if (!cell) {
                        return <div key={`e-${rowIdx}-${idx}`} className="h-[30px]" />;
                      }
                      const weekSelected = isInSelectedWeek(cell.key);
                      const isToday = cell.key === todayKey;
                      const isSelected = cell.key === selectedKey;
                      return (
                        <button
                          key={cell.key}
                          type="button"
                          onClick={() => {
                            onSelect(cell.date);
                            setOpen(false);
                          }}
                          aria-label={new Intl.DateTimeFormat("en-US", {
                            timeZone: "UTC",
                            dateStyle: "full",
                          }).format(cell.date)}
                          aria-pressed={isSelected}
                          aria-current={isToday ? "date" : undefined}
                          className={`${styles.day} ${weekSelected ? styles.dayInWeek : ""} ${isToday ? styles.dayToday : ""} ${isSelected ? styles.daySelected : ""}`}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className={styles.monthSection}>
              <div className={styles.heading}>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => setViewYear((y) => y - 1)}
                  aria-label="Previous year"
                >
                  ‹
                </button>
                <p className="font-semibold">
                  {viewYear}
                </p>
                <button
                  type="button"
                  className={styles.arrow}
                  onClick={() => setViewYear((y) => y + 1)}
                  aria-label="Next year"
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-4 gap-0.5">
                {MONTHS.map((name, i) => {
                  const month = i + 1;
                  const active = month === viewMonth;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setViewMonth(month)}
                      aria-pressed={active}
                      className={`${styles.month} ${active ? styles.monthSelected : ""}`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
