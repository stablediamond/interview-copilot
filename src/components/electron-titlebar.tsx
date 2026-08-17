"use client";

import * as React from "react";
import { Droplets, Minus, Pin, PinOff, Shield, ShieldOff, X } from "lucide-react";
import { getElectronAPI } from "@/lib/electron";
import { useSettings } from "@/hooks/use-settings";

// Custom window chrome for the frameless Electron overlay. Renders nothing in a
// normal browser. The bar itself is the OS drag region; buttons opt out.
// It's sticky so window controls (and the drag region) stay reachable even when
// the page below is scrolled.
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function ElectronTitlebar() {
  const [mounted, setMounted] = React.useState(false);
  const [pinned, setPinned] = React.useState(true);
  // Matches the main process's initial opacity (kept in sync after each cycle).
  const [opacity, setOpacity] = React.useState(0.9);
  const { settings, update, hydrated } = useSettings();

  React.useEffect(() => setMounted(true), []);

  // Sync the main process to the user's persisted stealth preference once
  // settings hydrate, and reflect hotkey toggles (Ctrl/Cmd+Shift+S) back.
  React.useEffect(() => {
    if (!hydrated) return;
    const api = getElectronAPI();
    if (!api) return;
    void api.stealth.set(settings.stealth);
    return api.stealth.onChanged((enabled) => update({ stealth: enabled }));
    // Sync once on hydrate; later changes flow through the button / hotkey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const api = mounted ? getElectronAPI() : null;
  if (!api) return null;

  const toggleStealth = () => {
    const next = !settings.stealth;
    update({ stealth: next });
    void api.stealth.set(next);
  };

  return (
    <div
      style={dragStyle}
      className="sticky top-0 z-50 flex h-8 shrink-0 items-center justify-between border-b border-border bg-card/90 px-2 backdrop-blur"
    >
      <span className="truncate text-[11px] font-medium text-muted-foreground">
        Interview Coach — ⌘/Ctrl+Shift+Enter
      </span>
      <div style={noDragStyle} className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={settings.stealth ? "Stealth on — hidden from screen share" : "Stealth off — visible in screen share"}
          title={
            settings.stealth
              ? "Stealth: on (hidden from screen capture) · ⌘/Ctrl+Shift+S"
              : "Stealth: off (visible in screen capture) · ⌘/Ctrl+Shift+S"
          }
          onClick={toggleStealth}
          className={
            settings.stealth
              ? "rounded p-1 text-success hover:bg-muted"
              : "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          }
        >
          {settings.stealth ? (
            <Shield className="h-3.5 w-3.5" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="Adjust opacity"
          title={`Opacity: ${Math.round(opacity * 100)}%`}
          onClick={async () => setOpacity(await api.cycleOpacity())}
          className="flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Droplets className="h-3.5 w-3.5" />
          <span className="text-[10px] tabular-nums">{Math.round(opacity * 100)}%</span>
        </button>
        <button
          type="button"
          aria-label={pinned ? "Unpin window" : "Pin window on top"}
          title={pinned ? "Always on top: on" : "Always on top: off"}
          onClick={async () => setPinned(await api.togglePin())}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => api.minimize()}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => api.close()}
          className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
