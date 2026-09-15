"use client";

import * as React from "react";
import { Eraser, Mic, MonitorSpeaker, Square } from "lucide-react";
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
import { apiFetch } from "@/lib/client";
import type { ConfigStatus } from "@/lib/types";
import { getElectronAPI, isElectron } from "@/lib/electron";
import { useLiveCaptions } from "@/hooks/use-live-captions";
import { useDeepgram } from "@/hooks/use-deepgram";
import {
  useOpenAiTranscription,
  type CaptureSource,
} from "@/hooks/use-openai-transcription";
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
    tokenize(trimmed),
  );
  return collapseRepeatedText(joinTokens(remaining).trim());
}

export type ChatGptCaptureHandle = {
  sendAnswer: () => Promise<void>;
};

export const ChatGptCapturePanel = React.forwardRef<
  ChatGptCaptureHandle,
  { questionOverride?: string }
>(function ChatGptCapturePanel({ questionOverride = "" }, ref) {
  const [sending, setSending] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [config, setConfig] = React.useState<ConfigStatus | null>(null);
  const [captureSource, setCaptureSource] =
    React.useState<CaptureChoice>("microphone");
  const [liveCaptionsAvailable, setLiveCaptionsAvailable] = React.useState(false);
  const committedRef = React.useRef("");
  const consumedKeyRef = React.useRef("");
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const questionRef = React.useRef(questionOverride);
  questionRef.current = questionOverride;

  React.useEffect(() => {
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
        [committedRef.current, fresh].filter(Boolean).join(" "),
      );
      setDraft(committedRef.current);
      return;
    }
    setDraft(
      collapseRepeatedText(
        [committedRef.current, fresh].filter(Boolean).join(" "),
      ),
    );
  }, []);

  const liveCaptions = useLiveCaptions({
    onTranscript,
    onError: (message) =>
      toast.error("Live Captions error", { description: message }),
  });
  const deepgram = useDeepgram({
    onTranscript,
    onError: (message) =>
      toast.error("Transcription error", { description: message }),
    language: settings.sttLanguage,
  });
  const openaiStt = useOpenAiTranscription({
    onTranscript,
    onError: (message) =>
      toast.error("Transcription error", { description: message }),
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
  const canRecord = Boolean(
    config?.transcriptionAvailable || liveCaptionsAvailable,
  );
  const electron = isElectron();

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

  const startRecording = () => {
    if (isLiveCaptions) {
      liveCaptions.start();
    } else if (useDeepgramEngine) {
      void deepgram.start();
    } else if (config?.openaiConfigured) {
      void openaiStt.start(captureSource as CaptureSource);
    } else {
      toast.error("No transcription available", {
        description:
          "Add an OpenAI key on Settings, or use Windows Live Captions.",
      });
    }
  };

  const stopRecording = () => {
    deepgram.stop();
    openaiStt.stop();
    liveCaptions.stop();
  };

  const sendAnswer = React.useCallback(async () => {
    const text =
      questionRef.current.trim() || draftRef.current.trim();
    if (!text) {
      toast.error("Nothing to send", {
        description: "Record or paste a caption, or type a specific question.",
      });
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
      markConsumedAndClear(draftRef.current);
    } finally {
      setSending(false);
    }
    // markConsumedAndClear is stable enough for this send path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useImperativeHandle(ref, () => ({ sendAnswer }), [sendAnswer]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
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
          disabled={sending || !electron}
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
          Live audio is off. Add an OpenAI key in Settings, or paste a caption
          below.
        </p>
      )}
      <CaptureStatus
        recording={isRecording}
        transcribing={openaiStt.processing}
        sending={sending}
      />
      <Textarea
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (!isRecording) committedRef.current = next;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void sendAnswer();
          }
        }}
        placeholder="Captions will appear here…"
        className="min-h-0 flex-1 resize-none"
      />
    </div>
  );
});

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
