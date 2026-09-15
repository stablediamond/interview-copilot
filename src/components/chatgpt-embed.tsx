"use client";

import * as React from "react";
import { ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CHATGPT_URL } from "@/lib/constants";
import { getElectronAPI, isElectron } from "@/lib/electron";

export function ChatGptEmbed() {
  const [shell, setShell] = React.useState<"pending" | "electron" | "browser">(
    "pending",
  );
  const [error, setError] = React.useState<string | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setShell(isElectron() ? "electron" : "browser");
  }, []);

  React.useEffect(() => {
    if (shell !== "electron") return;
    const api = getElectronAPI();
    if (!api?.chatgpt.getZoom) return;
    void api.chatgpt.getZoom().then((value) => {
      if (typeof value === "number") setZoom(value);
    });
  }, [shell]);

  React.useEffect(() => {
    if (shell !== "electron") return;
    const api = getElectronAPI();
    if (!api?.chatgpt) return;

    const publishLayout = () => {
      const host = hostRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      api.chatgpt.layout({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    };

    let raf = 0;
    const scheduleLayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(publishLayout);
    };

    void api.chatgpt.enter().then(async () => {
      scheduleLayout();
      if (api.chatgpt.getZoom) {
        const value = await api.chatgpt.getZoom();
        if (typeof value === "number") setZoom(value);
      }
    });

    const ro = new ResizeObserver(scheduleLayout);
    if (hostRef.current) ro.observe(hostRef.current);
    window.addEventListener("resize", scheduleLayout);
    window.addEventListener("scroll", scheduleLayout, true);
    const kick = window.setTimeout(scheduleLayout, 50);
    const unsubErr = api.chatgpt.onError((message) => setError(message));

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(kick);
      ro.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      window.removeEventListener("scroll", scheduleLayout, true);
      unsubErr();
      void api.chatgpt.leave();
    };
  }, [shell]);

  const signOutChatgpt = async () => {
    const api = getElectronAPI();
    if (!api?.chatgpt) return;
    setSigningOut(true);
    try {
      await api.chatgpt.clearSession();
      toast.success("Signed out of ChatGPT");
    } catch (err) {
      toast.error("Could not sign out of ChatGPT", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSigningOut(false);
    }
  };

  const changeZoom = async (direction: "in" | "out") => {
    const api = getElectronAPI();
    if (!api?.chatgpt) return;
    const next =
      direction === "in" ? await api.chatgpt.zoomIn() : await api.chatgpt.zoomOut();
    setZoom(next);
  };

  if (shell === "pending") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/95 px-1.5 py-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => void changeZoom("out")}
          disabled={shell !== "electron" || zoom <= 0.5}
          title="Zoom out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => void changeZoom("in")}
          disabled={shell !== "electron" || zoom >= 2}
          title="Zoom in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          onClick={() => void signOutChatgpt()}
          disabled={signingOut || shell !== "electron"}
        >
          {signingOut ? <Spinner /> : null}
          Signout
        </Button>
      </div>
      {error ? (
        <p className="shrink-0 px-2 py-1 text-[11px] text-destructive">{error}</p>
      ) : null}
      {shell === "browser" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            ChatGPT is embedded in the desktop app so your login stays on this
            machine. Open Interview Copilot with Electron to send briefs into ChatGPT.
          </p>
          <Button asChild>
            <a href={CHATGPT_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Open chatgpt.com
            </a>
          </Button>
        </div>
      ) : (
        <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 bg-background" />
      )}
    </div>
  );
}
