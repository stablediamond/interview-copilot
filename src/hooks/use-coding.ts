"use client";

import * as React from "react";
import { streamFetch } from "@/lib/client";
import { getElectronAPI, type CodingSource } from "@/lib/electron";
import {
  parseCodingStream,
  hasCodingContent,
  codingTurnTitle,
  type CodingSolution,
} from "@/lib/coding";

export type CodingModeChoice =
  | "auto"
  | "new"
  | "fix"
  | "optimize"
  | "explain"
  | "test"
  | "answer";

// A captured or pasted problem image, rendered and sent as a data URL.
export interface CaptureItem {
  id: string;
  dataUrl: string;
}

// A completed solve, kept so the candidate can flip back to earlier answers.
export interface CodingTurn {
  id: string;
  at: number;
  title: string;
  solution: CodingSolution;
  images: string[];
  ask: string;
}

const MAX_IMAGES = 8;
const MAX_HISTORY = 20;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptySolution(language: string): CodingSolution {
  return {
    mode: null,
    say: "",
    steps: [],
    language: language === "auto" ? "" : language,
    complexity: "",
    points: "",
    note: "",
    error: null,
  };
}

/**
 * State + actions for the live-coding copilot. Inputs are explicit and visible
 * (captures + an editable "what they asked" field) so the same problem yields
 * the same answer, and every solve is kept in history so nothing is lost.
 */
export function useCoding(opts: {
  candidateId?: string;
  getTranscript?: () => string;
}) {
  const { candidateId, getTranscript } = opts;

  const electron = React.useMemo(() => getElectronAPI(), []);
  const canNativeCapture = Boolean(electron?.coding);

  const [sources, setSources] = React.useState<CodingSource[]>([]);
  const [sourceId, setSourceId] = React.useState<string>("");
  const [loadingSources, setLoadingSources] = React.useState(false);

  const [images, setImages] = React.useState<CaptureItem[]>([]);
  const [pastedText, setPastedText] = React.useState("");
  // The interviewer's instruction/question, editable and visible. Empty by
  // default so answers are predictable; the candidate can pull the latest
  // transcript in with one click.
  const [ask, setAsk] = React.useState("");
  const [language, setLanguage] = React.useState<string>("auto");
  const [mode, setMode] = React.useState<CodingModeChoice>("auto");

  const [solution, setSolution] = React.useState<CodingSolution | null>(null);
  const [solving, setSolving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Session history of completed solves, and which one is on screen (null =
  // the live/most-recent solution).
  const [history, setHistory] = React.useState<CodingTurn[]>([]);
  const [activeTurnId, setActiveTurnId] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);

  const activeTurn =
    activeTurnId != null ? history.find((t) => t.id === activeTurnId) ?? null : null;

  // What's shown: a selected past turn, else the live solution.
  const displayedSolution = activeTurn?.solution ?? solution;
  const displayedImages = activeTurn ? activeTurn.images : images.map((c) => c.dataUrl);
  const viewingHistory = Boolean(activeTurn);

  const refreshSources = React.useCallback(async () => {
    if (!electron?.coding) return [];
    setLoadingSources(true);
    try {
      const list = await electron.coding.listSources();
      setSources(list);
      setSourceId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        const screen = list.find((s) => s.id.startsWith("screen"));
        return screen?.id ?? list[0]?.id ?? "";
      });
      return list;
    } finally {
      setLoadingSources(false);
    }
  }, [electron]);

  const addImage = React.useCallback((dataUrl: string) => {
    if (!dataUrl) return;
    // Adding an input implies we're working on the live turn again.
    setActiveTurnId(null);
    setImages((prev) =>
      prev.length >= MAX_IMAGES ? prev : [...prev, { id: uid(), dataUrl }]
    );
  }, []);

  const removeImage = React.useCallback((id: string) => {
    setImages((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const capture = React.useCallback(async () => {
    if (!electron?.coding) return;
    let id = sourceId;
    if (!id) {
      const list = await refreshSources();
      id = list.find((s) => s.id.startsWith("screen"))?.id ?? list[0]?.id ?? "";
    }
    if (!id) return;
    const dataUrl = await electron.coding.capture(id);
    if (dataUrl) addImage(dataUrl);
  }, [electron, sourceId, refreshSources, addImage]);

  const captureViaDisplayMedia = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen capture isn't available in this browser.");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const canvas = document.createElement("canvas");
      const settings = track.getSettings();
      canvas.width = settings.width ?? video.videoWidth ?? 1280;
      canvas.height = settings.height ?? video.videoHeight ?? 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not grab the frame.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      addImage(canvas.toDataURL("image/png"));
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }, [addImage]);

  // Pull the latest interviewer speech into the editable ask field.
  const pullAsk = React.useCallback(() => {
    const t = getTranscript?.() ?? "";
    if (t.trim()) setAsk(t.trim());
    return t.trim();
  }, [getTranscript]);

  const selectTurn = React.useCallback((id: string | null) => {
    setActiveTurnId(id);
  }, []);

  // Reset the live inputs for a brand-new problem (keeps history + prefs).
  const newProblem = React.useCallback(() => {
    abortRef.current?.abort();
    setImages([]);
    setPastedText("");
    setAsk("");
    setSolution(null);
    setError(null);
    setActiveTurnId(null);
  }, []);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const solve = React.useCallback(
    async (overrideMode?: CodingModeChoice) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Follow-ups build on the most recent completed turn.
      const prior = history[0]?.solution ?? null;
      const priorCode = prior
        ? prior.steps.map((s) => s.code).filter(Boolean).join("\n")
        : "";

      const imageUrls = images.map((c) => c.dataUrl);
      const payload = {
        images: imageUrls,
        pastedText,
        transcript: ask,
        language,
        mode: overrideMode ?? mode,
        candidateProfileId: candidateId || undefined,
        priorProblem: prior ? [prior.say, prior.points].filter(Boolean).join("\n") : "",
        currentCode: priorCode,
      };

      if (imageUrls.length === 0 && !pastedText.trim() && !ask.trim()) {
        setError("Capture a screenshot, paste the problem, or add the interviewer's ask first.");
        return;
      }

      setActiveTurnId(null);
      setSolving(true);
      setError(null);
      setSolution(emptySolution(language));

      try {
        const full = await streamFetch(
          "/api/coding/solve",
          {
            method: "POST",
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
          (acc) => {
            const parsed = parseCodingStream(acc);
            if (hasCodingContent(parsed)) setSolution(parsed);
          }
        );
        const parsed = parseCodingStream(full);
        setSolution(parsed);
        if (parsed.error) {
          setError(parsed.error);
        } else if (hasCodingContent(parsed)) {
          const turn: CodingTurn = {
            id: uid(),
            at: Date.now(),
            title: codingTurnTitle(parsed),
            solution: parsed,
            images: imageUrls,
            ask,
          };
          setHistory((prev) => [turn, ...prev].slice(0, MAX_HISTORY));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to solve.");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setSolving(false);
        }
      }
    },
    [images, pastedText, ask, language, mode, candidateId, history]
  );

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    canNativeCapture,
    sources,
    sourceId,
    setSourceId,
    loadingSources,
    refreshSources,
    images,
    addImage,
    removeImage,
    pastedText,
    setPastedText,
    ask,
    setAsk,
    pullAsk,
    language,
    setLanguage,
    mode,
    setMode,
    capture,
    captureViaDisplayMedia,
    solution,
    solving,
    error,
    solve,
    stop,
    newProblem,
    // History + navigation.
    history,
    activeTurnId,
    selectTurn,
    viewingHistory,
    displayedSolution,
    displayedImages,
    maxImages: MAX_IMAGES,
  };
}
