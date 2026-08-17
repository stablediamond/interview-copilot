"use client";

import * as React from "react";
import { apiFetch } from "@/lib/client";

export type RecordingState = "idle" | "connecting" | "recording" | "error";

interface UseDeepgramOptions {
  /** Called with each transcript chunk. isFinal=true for finalized text. */
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  /** ISO-639-1 language code, or "auto"/empty to let Deepgram detect. */
  language?: string;
}

/**
 * Browser-side Deepgram live transcription. A short-lived JWT is minted by the
 * server (the raw API key never reaches the browser), then audio captured from
 * the microphone is streamed to Deepgram's listen WebSocket.
 */
export function useDeepgram({
  onTranscript,
  onError,
  language = "en",
}: UseDeepgramOptions) {
  const [state, setState] = React.useState<RecordingState>("idle");
  const languageRef = React.useRef(language);
  React.useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const wsRef = React.useRef<WebSocket | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const keepAliveRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep latest callbacks without retriggering effects.
  const onTranscriptRef = React.useRef(onTranscript);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onTranscript, onError]);

  const cleanup = React.useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          // ignore
        }
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }, []);

  const stop = React.useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  const start = React.useCallback(async () => {
    if (state === "recording" || state === "connecting") return;
    setState("connecting");

    try {
      // 1) Microphone permission + stream.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2) Short-lived token from our server proxy.
      const { accessToken } = await apiFetch<{ accessToken: string }>(
        "/api/deepgram/token"
      );

      // 3) Open Deepgram listen socket using the bearer subprotocol.
      const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        interim_results: "true",
        punctuate: "true",
      });
      const lang = languageRef.current;
      if (lang && lang !== "auto") params.set("language", lang);
      else params.set("detect_language", "true");
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`,
        ["bearer", accessToken]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        // Stream audio in small chunks for low latency.
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        );
        recorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };
        recorder.start(250);

        // Keep the socket alive during silences.
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8000);

        setState("recording");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.type && data.type !== "Results") return;
          const alt = data?.channel?.alternatives?.[0];
          const transcript: string = alt?.transcript ?? "";
          if (transcript.trim()) {
            onTranscriptRef.current(transcript, Boolean(data.is_final));
          }
        } catch {
          // Ignore non-JSON / control frames.
        }
      };

      ws.onerror = () => {
        const message = "Live transcription connection error.";
        onErrorRef.current?.(message);
        cleanup();
        setState("error");
      };

      ws.onclose = () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          cleanup();
          setState("idle");
        }
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start microphone.";
      onErrorRef.current?.(message);
      cleanup();
      setState("error");
    }
  }, [state, cleanup]);

  React.useEffect(() => cleanup, [cleanup]);

  return { state, start, stop, isRecording: state === "recording" };
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}
