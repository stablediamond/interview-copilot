"use client";

import * as React from "react";
import { apiFetch } from "@/lib/client";

export type CaptureSource = "microphone" | "display" | "both";
export type OpenAiRecordingState = "idle" | "starting" | "recording" | "error";

interface UseOpenAiTranscriptionOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  /** Segment length in ms. Each segment is transcribed independently. */
  segmentMs?: number;
  /** ISO-639-1 language code, or "auto"/empty to detect. */
  language?: string;
}

/**
 * Near-live transcription using only OpenAI. Audio is captured from the
 * microphone or a shared meeting tab / system audio (getDisplayMedia) and
 * recorded in short, self-contained segments. Each finished segment is posted
 * to /api/transcribe and the text is appended to the transcript.
 */
export function useOpenAiTranscription({
  onTranscript,
  onError,
  segmentMs = 5000,
  language = "en",
}: UseOpenAiTranscriptionOptions) {
  const [state, setState] = React.useState<OpenAiRecordingState>("idle");
  // True while at least one segment is being uploaded/transcribed.
  const [processing, setProcessing] = React.useState(false);
  const inflightRef = React.useRef(0);
  const languageRef = React.useRef(language);
  React.useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const streamRef = React.useRef<MediaStream | null>(null);
  // Underlying source streams (mic/display) kept so we can stop their tracks.
  const sourceStreamsRef = React.useRef<MediaStream[]>([]);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const rotateTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = React.useRef(false);
  const mimeRef = React.useRef<string | undefined>(undefined);

  const onTranscriptRef = React.useRef(onTranscript);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onTranscript, onError]);

  const cleanup = React.useCallback(() => {
    stoppingRef.current = true;
    if (rotateTimer.current) {
      clearInterval(rotateTimer.current);
      rotateTimer.current = null;
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
    for (const s of sourceStreamsRef.current) {
      s.getTracks().forEach((t) => t.stop());
    }
    sourceStreamsRef.current = [];
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stop = React.useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  const sendSegment = React.useCallback(async (blob: Blob, ext: string) => {
    if (blob.size < 1200) return; // skip near-empty/silent segments
    inflightRef.current += 1;
    setProcessing(true);
    try {
      const form = new FormData();
      form.append("file", blob, `segment.${ext}`);
      if (languageRef.current && languageRef.current !== "auto") {
        form.append("language", languageRef.current);
      }
      const { text } = await apiFetch<{ text: string }>("/api/transcribe", {
        method: "POST",
        body: form,
      });
      if (text.trim()) onTranscriptRef.current(text.trim(), true);
    } catch (err) {
      onErrorRef.current?.(
        err instanceof Error ? err.message : "Transcription request failed."
      );
    } finally {
      inflightRef.current = Math.max(0, inflightRef.current - 1);
      if (inflightRef.current === 0) setProcessing(false);
    }
  }, []);

  const startRecorder = React.useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType = mimeRef.current;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = mimeType?.split(";")[0] || "audio/webm";
      const ext = type.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      void sendSegment(blob, ext);
    };

    recorder.start();
    recorderRef.current = recorder;
  }, [sendSegment]);

  const rotate = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // triggers onstop -> send, then we start a fresh segment
    }
    if (!stoppingRef.current) startRecorder();
  }, [startRecorder]);

  const start = React.useCallback(
    async (source: CaptureSource) => {
      if (state === "recording" || state === "starting") return;
      setState("starting");
      stoppingRef.current = false;

      try {
        const sourceStreams: MediaStream[] = [];

        const getDisplayAudio = async (): Promise<MediaStream> => {
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
          const audioTracks = display.getAudioTracks();
          if (audioTracks.length === 0) {
            display.getTracks().forEach((t) => t.stop());
            throw new Error(
              "No audio was shared. Re-share and enable 'Share tab audio' (or share a tab/window/screen with sound)."
            );
          }
          display.getVideoTracks().forEach((t) => t.stop());
          return display;
        };

        let stream: MediaStream;

        if (source === "microphone") {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          sourceStreams.push(mic);
          stream = mic;
        } else if (source === "display") {
          const display = await getDisplayAudio();
          sourceStreams.push(display);
          stream = new MediaStream(display.getAudioTracks());
        } else {
          // "both": mix microphone + shared meeting audio into one stream so the
          // transcript includes you and the interviewer.
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          const display = await getDisplayAudio();
          sourceStreams.push(mic, display);

          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(mic).connect(dest);
          ctx
            .createMediaStreamSource(new MediaStream(display.getAudioTracks()))
            .connect(dest);
          stream = dest.stream;
        }

        sourceStreamsRef.current = sourceStreams;
        streamRef.current = stream;

        // If the user stops sharing from the browser UI, clean up.
        for (const s of sourceStreams) {
          s.getAudioTracks().forEach((track) => {
            track.addEventListener("ended", () => stop());
          });
        }

        mimeRef.current = pickMimeType();
        startRecorder();
        rotateTimer.current = setInterval(rotate, segmentMs);
        setState("recording");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not start capture.";
        onErrorRef.current?.(message);
        cleanup();
        setState("error");
      }
    },
    [state, segmentMs, startRecorder, rotate, cleanup, stop]
  );

  React.useEffect(() => cleanup, [cleanup]);

  return { state, start, stop, processing, isRecording: state === "recording" };
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
