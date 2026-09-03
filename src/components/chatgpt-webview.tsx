"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  Home,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CHATGPT_URL } from "@/lib/constants";
import {
  getElectronAPI,
  isElectron,
  type ChatgptNavState,
} from "@/lib/electron";

const EMPTY_NAV: ChatgptNavState = {
  url: CHATGPT_URL,
  title: "ChatGPT",
  canGoBack: false,
  canGoForward: false,
  loading: true,
};

export function ChatGptWebview() {
  const [shell, setShell] = React.useState<"pending" | "electron" | "browser">(
    "pending"
  );
  const [nav, setNav] = React.useState<ChatgptNavState>(EMPTY_NAV);
  const [error, setError] = React.useState<string | null>(null);
  const [clearing, setClearing] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState(CHATGPT_URL);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const urlInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setShell(isElectron() ? "electron" : "browser");
  }, []);

  React.useEffect(() => {
    if (shell !== "electron") return;
    const api = getElectronAPI();
    if (!api?.chatgpt) return;

    void api.chatgpt.enter();

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

    const ro = new ResizeObserver(scheduleLayout);
    if (hostRef.current) ro.observe(hostRef.current);
    window.addEventListener("resize", scheduleLayout);
    const kick = window.setTimeout(scheduleLayout, 50);

    const unsubNav = api.chatgpt.onNav((state) => {
      setNav(state);
      if (!urlInputRef.current || document.activeElement !== urlInputRef.current) {
        setUrlDraft(state.url || CHATGPT_URL);
      }
      if (!state.loading) setError(null);
    });
    const unsubErr = api.chatgpt.onError((message) => setError(message));

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(kick);
      ro.disconnect();
      window.removeEventListener("resize", scheduleLayout);
      unsubNav();
      unsubErr();
      void api.chatgpt.leave();
    };
  }, [shell]);

  const clearLogin = async () => {
    if (
      !window.confirm(
        "Sign out of ChatGPT in this app? Your saved ChatGPT login on this device will be removed."
      )
    ) {
      return;
    }
    const api = getElectronAPI();
    if (!api?.chatgpt) return;
    setClearing(true);
    try {
      await api.chatgpt.clearSession();
    } finally {
      setClearing(false);
    }
  };

  const submitUrl = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const api = getElectronAPI();
    if (!api?.chatgpt) return;
    const result = await api.chatgpt.navigate(urlDraft);
    if (!result.ok) {
      setError(result.error || "Could not open that address.");
      return;
    }
    if (result.url) setUrlDraft(result.url);
  };

  if (shell === "pending") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (shell === "browser") {
    return <BrowserFallback />;
  }

  const api = getElectronAPI();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/80 px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!nav.canGoBack}
          onClick={() => void api?.chatgpt.goBack()}
          title="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!nav.canGoForward}
          onClick={() => void api?.chatgpt.goForward()}
          title="Forward"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void api?.chatgpt.reload()}
          title="Reload"
        >
          <RotateCw className={nav.loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void api?.chatgpt.home()}
          title="chatgpt.com"
        >
          <Home className="h-4 w-4" />
        </Button>
        <form className="min-w-0 flex-1" onSubmit={(e) => void submitUrl(e)}>
          <Input
            ref={urlInputRef}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setUrlDraft(nav.url || CHATGPT_URL);
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Address"
            placeholder="https://chatgpt.com"
            className="h-8 border-transparent bg-secondary/50 px-2 font-mono text-[11px] shadow-none focus-visible:border-input focus-visible:bg-background"
          />
        </form>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void clearLogin()}
          disabled={clearing}
          title="Clear saved ChatGPT login"
        >
          {clearing ? <Spinner /> : <Eraser className="h-3.5 w-3.5" />} Sign out
        </Button>
      </div>
      {error && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 bg-background"
      />
    </div>
  );
}

function BrowserFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">
        ChatGPT is embedded in the desktop app so your login stays on this
        machine. Open Interview Coach with Electron, or continue in a browser tab.
      </p>
      <Button asChild>
        <a href={CHATGPT_URL} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Open chatgpt.com
        </a>
      </Button>
    </div>
  );
}
