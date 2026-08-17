import * as React from "react";
import { getElectronAPI } from "@/lib/electron";
import { CaptionReconciler } from "@/lib/caption-reconciler";

interface UseLiveCaptionsOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
}

type LiveCaptionState = "idle" | "recording";

export function useLiveCaptions({
  onTranscript,
  onError,
}: UseLiveCaptionsOptions) {
  const [state, setState] = React.useState<LiveCaptionState>("idle");

  const onTranscriptRef = React.useRef(onTranscript);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const reconciler = React.useRef(new CaptionReconciler());
  const unsubText = React.useRef<(() => void) | null>(null);
  const unsubError = React.useRef<(() => void) | null>(null);

  const stop = React.useCallback(() => {
    getElectronAPI()?.liveCaptions.stop();
    unsubText.current?.();
    unsubText.current = null;
    unsubError.current?.();
    unsubError.current = null;
    reconciler.current.reset();
    setState("idle");
  }, []);

  const start = React.useCallback(() => {
    const api = getElectronAPI();
    if (!api) {
      onErrorRef.current?.("Live Captions is only available in the desktop app.");
      return;
    }
    if (api.platform !== "win32") {
      onErrorRef.current?.("Live Captions capture is Windows-only.");
      return;
    }

    reconciler.current.reset();
    unsubText.current = api.liveCaptions.onText((text) => {
      const { finals, interim } = reconciler.current.push(text);
      for (const sentence of finals) onTranscriptRef.current(sentence, true);
      onTranscriptRef.current(interim, false);
    });
    unsubError.current = api.liveCaptions.onError((message) =>
      onErrorRef.current?.(message)
    );
    api.liveCaptions.start();
    setState("recording");
  }, []);

  React.useEffect(() => () => stop(), [stop]);

  return { state, start, stop, isRecording: state === "recording" };
}
