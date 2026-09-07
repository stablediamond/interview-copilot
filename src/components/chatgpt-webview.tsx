"use client";

import * as React from "react";
import { Eraser, ExternalLink, Mic, MonitorSpeaker, Square, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHATGPT_URL } from "@/lib/constants";
import { apiFetch } from "@/lib/client";
import type { ConfigStatus } from "@/lib/types";
import { getElectronAPI, isElectron } from "@/lib/electron";
import { useLiveCaptions } from "@/hooks/use-live-captions";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useOpenAiTranscription, type CaptureSource } from "@/hooks/use-openai-transcription";
import { useSettings } from "@/hooks/use-settings";
import {
  collapseRepeatedText,
  joinTokens,
  remainingAfterConsumed,
  sentenceKey,
  tokenize,
} from "@/lib/caption-reconciler";

type CaptureChoice = CaptureSource | "livecaption";

function onlyNewCaption(text: string, consumedKey: string): string {
  const trimmed = collapseRepeatedText(text.trim());
  if (!trimmed) return "";
  if (!consumedKey) return trimmed;
  const remaining = remainingAfterConsumed(
    consumedKey.split(" ").filter(Boolean),
    tokenize(trimmed)
  );
  return collapseRepeatedText(joinTokens(remaining).trim());
}

const RIGHT_WIDTH_KEY = "interview-copilot.chatgpt-right-width";
const DEFAULT_RIGHT = 280;
const MIN_RIGHT = 240;
const MIN_LEFT = 220;

function readRightWidth() {
  if (typeof window === "undefined") return DEFAULT_RIGHT;
  const raw = Number(window.localStorage.getItem(RIGHT_WIDTH_KEY));
  return Number.isFinite(raw) ? Math.max(MIN_RIGHT, raw) : DEFAULT_RIGHT;
}

export function ChatGptWebview() {
  const [shell, setShell] = React.useState<"pending" | "electron" | "browser">(
    "pending"
  );
  const [error, setError] = React.useState<string | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [zoom, setZoom] = React.useState(1);
  const [rightWidth, setRightWidth] = React.useState(DEFAULT_RIGHT);
  const [dragging, setDragging] = React.useState(false);
  const [config, setConfig] = React.useState<ConfigStatus | null>(null);
  const [captureSource, setCaptureSource] = React.useState<CaptureChoice>("microphone");
  const [liveCaptionsAvailable, setLiveCaptionsAvailable] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const splitRef = React.useRef<HTMLDivElement | null>(null);
  const committedRef = React.useRef("");
  const consumedKeyRef = React.useRef("");
  const rightWidthRef = React.useRef(rightWidth);
  rightWidthRef.current = rightWidth;

  React.useEffect(() => {
    setShell(isElectron() ? "electron" : "browser");
    setRightWidth(readRightWidth());
    const api = getElectronAPI();
    const liveOnWindows = Boolean(api) && api?.platform === "win32";
    setLiveCaptionsAvailable(liveOnWindows);
    if (liveOnWindows) setCaptureSource("livecaption");
    void apiFetch<ConfigStatus>("/api/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const { settings } = useSettings();

  const onTranscript = React.useCallback((text: string, isFinal: boolean) => {
    const fresh = onlyNewCaption(text, consumedKeyRef.current);
    if (isFinal) {
      if (!fresh) return;
      committedRef.current = collapseRepeatedText(
        [committedRef.current, fresh].filter(Boolean).join(" ")
      );
      setDraft(committedRef.current);
      return;
    }
    setDraft(
      collapseRepeatedText([committedRef.current, fresh].filter(Boolean).join(" "))
    );
  }, []);

  const liveCaptions = useLiveCaptions({
    onTranscript,
    onError: (message) => toast.error("Live Captions error", { description: message }),
  });
  const deepgram = useDeepgram({
    onTranscript,
    onError: (message) => toast.error("Transcription error", { description: message }),
    language: settings.sttLanguage,
  });
  const openaiStt = useOpenAiTranscription({
    onTranscript,
    onError: (message) => toast.error("Transcription error", { description: message }),
    segmentMs: Math.max(2, settings.sttSegmentSeconds || 4) * 1000,
    language: settings.sttLanguage,
  });

  const isLiveCaptions = captureSource === "livecaption";
  const useDeepgramEngine =
    !isLiveCaptions &&
    Boolean(config?.deepgramConfigured) &&
    captureSource === "microphone";
  const isRecording =
    deepgram.isRecording || openaiStt.isRecording || liveCaptions.isRecording;
  const isStarting =
    deepgram.state === "connecting" || openaiStt.state === "starting";
  const canRecord = Boolean(config?.transcriptionAvailable || liveCaptionsAvailable);

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
    const kick = window.setTimeout(scheduleLayout, 50);

    const unsubErr = api.chatgpt.onError((message) => setError(message));

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(kick);
      ro.disconnect();
      window.removeEventListener("resize", scheduleLayout);
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

  const markConsumedAndClear = (text: string) => {
    liveCaptions.checkpoint(text);
    const key = sentenceKey(text);
    if (key) {
      consumedKeyRef.current = consumedKeyRef.current
        ? `${consumedKeyRef.current} ${key}`
        : key;
      const parts = consumedKeyRef.current.split(" ").filter(Boolean);
      if (parts.length > 400) {
        consumedKeyRef.current = parts.slice(-400).join(" ");
      }
    }
    committedRef.current = "";
    setDraft("");
  };

  const clearDraft = () => {
    markConsumedAndClear(draft);
  };

  const changeZoom = async (direction: "in" | "out") => {
    const api = getElectronAPI();
    if (!api?.chatgpt) return;
    const next = direction === "in" ? await api.chatgpt.zoomIn() : await api.chatgpt.zoomOut();
    setZoom(next);
  };

  const onSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = rightWidthRef.current;
    setDragging(true);

    const onMove = (move: PointerEvent) => {
      const parentWidth = splitRef.current?.parentElement?.clientWidth ?? 800;
      const maxRight = Math.max(MIN_RIGHT, parentWidth - MIN_LEFT);
      const next = Math.min(maxRight, Math.max(MIN_RIGHT, startWidth + (startX - move.clientX)));
      setRightWidth(next);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragging(false);
      try {
        window.localStorage.setItem(RIGHT_WIDTH_KEY, String(rightWidthRef.current));
      } catch {
        // ignore
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const startRecording = () => {
    if (isLiveCaptions) {
      liveCaptions.start();
    } else if (useDeepgramEngine) {
      void deepgram.start();
    } else if (config?.openaiConfigured) {
      void openaiStt.start(captureSource as CaptureSource);
    } else {
      toast.error("No transcription available", {
        description: "Add an OpenAI key on Settings, or use Windows Live Captions.",
      });
    }
  };

  const stopRecording = () => {
    deepgram.stop();
    openaiStt.stop();
    liveCaptions.stop();
  };

  const sendAnswer = async () => {
    const text = draft.trim();
    if (!text) {
      toast.error("Nothing to send", { description: "Add text first, or click Record." });
      return;
    }
    const api = getElectronAPI();
    if (!api?.chatgpt.submit) {
      toast.error("ChatGPT is not available", {
        description: "Open Interview Copilot in the desktop app.",
      });
      return;
    }
    setSending(true);
    try {
      const result = await api.chatgpt.submit(text);
      if (!result.ok) {
        toast.error("Could not send to ChatGPT", {
          description: result.error || "Open a ChatGPT chat and try again.",
        });
        return;
      }
      markConsumedAndClear(text);
    } finally {
      setSending(false);
    }
  };

  if (shell === "pending") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 ${dragging ? "select-none" : ""}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
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
        {shell === "browser" ? (
          <BrowserFallback />
        ) : (
          <div ref={hostRef} className="relative min-h-0 min-w-0 flex-1 bg-background" />
        )}
      </div>
      <div
        ref={splitRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onPointerDown={onSplitPointerDown}
        className={`w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 ${
          dragging ? "bg-primary/60" : ""
        }`}
      />
      <aside
        style={{ width: rightWidth }}
        className="flex shrink-0 flex-col gap-2 bg-card/95 p-2 pb-14"
      >
        <div className="flex items-center gap-1">
          {isRecording ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 min-w-0 flex-1 gap-1 px-1.5"
              onClick={stopRecording}
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 min-w-0 flex-1 gap-1 px-1.5"
              onClick={startRecording}
              disabled={isStarting || !canRecord}
            >
              {isStarting ? (
                <Spinner />
              ) : captureSource === "display" ? (
                <MonitorSpeaker className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              Record
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 min-w-0 flex-1 gap-1 px-1.5"
            onClick={clearDraft}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 min-w-0 flex-1 gap-1 px-1.5"
            onClick={() => void sendAnswer()}
            disabled={sending || shell !== "electron"}
          >
            {sending ? <Spinner /> : null}
            Answer
          </Button>
        </div>
        {canRecord ? (
          <Select
            value={captureSource}
            onValueChange={(v) => setCaptureSource(v as CaptureChoice)}
            disabled={isRecording || isStarting}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {liveCaptionsAvailable && (
                <SelectItem value="livecaption">Windows Live Captions</SelectItem>
              )}
              {config?.transcriptionAvailable && (
                <>
                  <SelectItem value="microphone">Microphone</SelectItem>
                  <SelectItem value="display">Meeting tab audio</SelectItem>
                  <SelectItem value="both">Mic + meeting audio</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        ) : (
          <p className="rounded-md bg-secondary/60 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            Live audio is off. Add an OpenAI key in Settings, or paste a caption below.
          </p>
        )}
        <CaptureStatus
          recording={isRecording}
          transcribing={openaiStt.processing}
          sending={sending}
        />
        {error && (
          <p className="text-[11px] leading-snug text-destructive">{error}</p>
        )}
        <Textarea
          value={draft}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (!isRecording) committedRef.current = next;
          }}
          placeholder="Captions will appear here…"
          className="min-h-0 flex-1 resize-none"
        />
      </aside>
    </div>
  );
}

function CaptureStatus({
  recording,
  transcribing,
  sending,
}: {
  recording: boolean;
  transcribing: boolean;
  sending: boolean;
}) {
  let dot = "bg-muted-foreground/50";
  let text = "Idle — record audio or paste a caption";
  let tone = "text-muted-foreground";
  let pulse = false;

  if (sending) {
    dot = "bg-primary";
    text = "Sending to ChatGPT…";
    tone = "text-foreground";
    pulse = true;
  } else if (transcribing) {
    dot = "bg-warning";
    text = "Transcribing…";
    tone = "text-foreground";
    pulse = true;
  } else if (recording) {
    dot = "bg-destructive";
    text = "Listening…";
    tone = "text-foreground";
    pulse = true;
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] leading-snug">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dot} ${pulse ? "animate-pulse-dot" : ""}`}
      />
      <span className={tone}>{text}</span>
    </div>
  );
}

function BrowserFallback() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">
        ChatGPT is embedded in the desktop app so your login stays on this
        machine. Open Interview Copilot with Electron, or continue in a browser tab.
      </p>
      <Button asChild>
        <a href={CHATGPT_URL} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Open chatgpt.com
        </a>
      </Button>
    </div>
  );
}
