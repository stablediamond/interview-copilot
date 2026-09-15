"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatTimeZoneLabel,
  listTimeZoneOptions,
  type TimeZoneOption,
} from "@/lib/timezones";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function TimeZonePicker({
  value,
  onChange,
  id = "cal-tz",
}: {
  value: string;
  onChange: (timeZone: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => listTimeZoneOptions(new Date()), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.searchText.includes(q));
  }, [options, query]);

  const selectedLabel = useMemo(() => formatTimeZoneLabel(value), [value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function select(opt: TimeZoneOption) {
    onChange(opt.id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 items-center gap-2">
      <Label htmlFor={id} className="whitespace-nowrap text-xs text-muted-foreground">
        Time zone
      </Label>
      <div className="relative min-w-[18rem] max-w-md flex-1">
        <Input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          className="h-8 whitespace-nowrap truncate"
          placeholder="Country, city, EST, UTC+4…"
          value={open ? query : selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onClick={() => {
            setOpen(true);
            setQuery("");
          }}
        />
        {open ? (
          <ul
            id={`${id}-list`}
            role="listbox"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No matching time zones
              </li>
            ) : (
              filtered.map((opt) => {
                const active = opt.id === value;
                return (
                  <li key={opt.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={cn(
                        "block w-full truncate whitespace-nowrap px-3 py-1.5 text-left text-sm",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/70"
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => select(opt)}
                      title={opt.label}
                    >
                      {opt.label}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
