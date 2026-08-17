"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Mic,
  Square,
  Eraser,
  Sparkles,
  RefreshCw,
  Save,
  Keyboard,
  AlertTriangle,
  MonitorSpeaker,
  Info,
  ChevronRight,
  Compass,
  Code2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichAnswer } from "@/components/rich-answer";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { CodingPanel } from "@/components/coding-panel";
import { apiFetch, streamFetch } from "@/lib/client";
import { parseAnswerStream, answerGist } from "@/lib/answer-stream";
import { collapseRepeatedText } from "@/lib/caption-reconciler";
import { styleRiskNote } from "@/lib/answer-style";
import { getElectronAPI } from "@/lib/electron";
import { useSettings } from "@/hooks/use-settings";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useLiveCaptions } from "@/hooks/use-live-captions";
import {
  useOpenAiTranscription,
  type CaptureSource,
} from "@/hooks/use-openai-transcription";

// Capture sources include OpenAI/Deepgram audio plus the Windows Live Captions
// bridge (desktop app only).
type CaptureChoice = CaptureSource | "livecaption";

import type { AnswerMode, InterviewStage } from "@/lib/schemas";
import { INTERVIEW_STAGE_LABELS, INTERVIEW_STAGE_HINTS } from "@/lib/constants";
import { interviewStageSchema } from "@/lib/schemas";
import type {
  ConfigStatus,
  AnswerResult,
  ProfilesResponse,
  CandidateProfileDto,
  JobProfileDto,
} from "@/lib/session-types";
import type { PositioningBrief, BriefProject, BriefQa, WeakSpot } from "@/lib/types";

// Static class strings so Tailwind keeps them; maps the answer-size setting.
const ANSWER_FONT_SIZE_CLASS = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
} as const;

// Cap retained final chunks so the transcript doesn't grow without bound (which
// forced manual clearing). The answer model already uses a time-windowed slice.
const MAX_FINALS = 80;

// Cap the in-session answer log so it doesn't grow without bound.
const MAX_LOG = 40;

interface FinalChunk {
  text: string;
  at: number;
  // Monotonic id so we can mark "answered up to here" even after old chunks are
  // pruned (array indices shift on prune; seq does not).
  seq: number;
}

interface PriorTurnState {
  question: string;
  answerGist: string;
}

interface LogEntry {
  id: string;
  question: string;
  answer: string;
  confidence: string;
  at: number;
}

// Result of a streaming generate/rewrite run.
type StreamOutcome =
  | { kind: "answer"; result: AnswerResult }
  | { kind: "no_answer" }
  | { kind: "superseded" };

export default function SessionPage() {
  const { settings, hydrated } = useSettings();

  const [config, setConfig] = React.useState<ConfigStatus | null>(null);
  const [candidates, setCandidates] = React.useState<CandidateProfileDto[]>([]);
  const [jobs, setJobs] = React.useState<JobProfileDto[]>([]);
  const [candidateId, setCandidateId] = React.useState<string>("");
  const [jobId, setJobId] = React.useState<string>("");

  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = React.useState("");

  // Transcript state.
  const [finals, setFinals] = React.useState<FinalChunk[]>([]);
  const [interim, setInterim] = React.useState("");
  const [manualCaption, setManualCaption] = React.useState("");

  // Optional question override + answer.
  const [detectedQuestion, setDetectedQuestion] = React.useState("");
  // Question type is no longer separately classified; the one-shot model infers
  // intent. Kept for the saved turn record.
  const questionType = "other";
  const [answer, setAnswer] = React.useState<AnswerResult | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [lastMode, setLastMode] = React.useState<AnswerMode>("default");
  const [interviewStage, setInterviewStage] =
    React.useState<InterviewStage>("general");
  const [autoAnswer, setAutoAnswer] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Live-coding copilot overlay.
  const [codingOpen, setCodingOpen] = React.useState(false);
  // Readiness signal so you know exactly when to press Generate.
  const [questionReady, setQuestionReady] = React.useState(false);
  const [readyConfidence, setReadyConfidence] = React.useState<string>("medium");
  // In-session log of generated Q/A turns (newest first), collapsible for reference.
  const [log, setLog] = React.useState<LogEntry[]>([]);

  // Strategic positioning brief for the selected (candidate, job) pair. Built
  // once and cached server-side; it's injected into every answer automatically.
  const [positioning, setPositioning] = React.useState<PositioningBrief | null>(null);
  const [briefLoading, setBriefLoading] = React.useState(false);
  const [briefBuilding, setBriefBuilding] = React.useState(false);

  // Refs to avoid stale closures in async/debounced handlers.
  const finalsRef = React.useRef<FinalChunk[]>([]);
  const interimRef = React.useRef("");
  const detectedRef = React.useRef("");
  const lastAnsweredRef = React.useRef("");
  // End-of-turn (pause) detection for the live answer flow.
  const endOfTurnTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEndOfTurnRef = React.useRef<() => void>(() => {});
  // Monotonic sequence for final chunks, and the marker of the last chunk we've
  // already answered (so Generate sends only what's new). prevConsumedSeqRef
  // keeps the value from before the last answer, so a mis-click is recoverable
  // via Regenerate (which reads a wider window and ignores the marker).
  const seqRef = React.useRef(0);
  const consumedSeqRef = React.useRef(0);
  const prevConsumedSeqRef = React.useRef(0);
  // The interim text we last answered. When Live Captions finalizes it into a
  // final chunk afterward, we strip that overlap so it isn't answered twice.
  const consumedInterimRef = React.useRef("");
  // Streaming + session memory.
  const streamAbort = React.useRef<AbortController | null>(null);
  const priorTurnsRef = React.useRef<PriorTurnState[]>([]);
  // Mirror of `answer` so async handlers can restore it (e.g. after NO_ANSWER)
  // without depending on stale closure state.
  const answerRef = React.useRef<AnswerResult | null>(null);

  React.useEffect(() => {
    answerRef.current = answer;
  }, [answer]);
  React.useEffect(() => {
    finalsRef.current = finals;
  }, [finals]);
  React.useEffect(() => {
    interimRef.current = interim;
  }, [interim]);
  React.useEffect(() => {
    detectedRef.current = detectedQuestion;
  }, [detectedQuestion]);

  // Initialize autoAnswer + lastMode from settings once hydrated.
  React.useEffect(() => {
    if (hydrated) {
      setAutoAnswer(settings.autoAnswer);
      setLastMode(settings.defaultAnswerMode);
      setInterviewStage(settings.defaultInterviewStage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Load config + profiles.
  React.useEffect(() => {
    (async () => {
      try {
        const [cfg, profiles] = await Promise.all([
          apiFetch<ConfigStatus>("/api/config"),
          apiFetch<ProfilesResponse>("/api/profiles"),
        ]);
        setConfig(cfg);
        setCandidates(profiles.candidates);
        setJobs(profiles.jobs);
        setCandidateId(profiles.candidates[0]?.id ?? "");
        setJobId(profiles.jobs[0]?.id ?? "");
      } catch (err) {
        toast.error("Could not load session data", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();
  }, []);

  // Load any cached positioning brief whenever the candidate/job pair changes.
  React.useEffect(() => {
    if (!candidateId || !jobId) {
      setPositioning(null);
      return;
    }
    let cancelled = false;
    setBriefLoading(true);
    (async () => {
      try {
        const { brief } = await apiFetch<{ brief: PositioningBrief | null }>(
          `/api/positioning-brief?candidateProfileId=${encodeURIComponent(
            candidateId
          )}&jobProfileId=${encodeURIComponent(jobId)}`
        );
        if (!cancelled) setPositioning(brief);
      } catch {
        if (!cancelled) setPositioning(null);
      } finally {
        if (!cancelled) setBriefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId, jobId]);

  const buildBrief = React.useCallback(async () => {
    if (!candidateId || !jobId) {
      toast.error("Pick a candidate and a job profile first.");
      return;
    }
    setBriefBuilding(true);
    try {
      const { brief } = await apiFetch<{ brief: PositioningBrief }>(
        "/api/positioning-brief",
        {
          method: "POST",
          body: JSON.stringify({
            candidateProfileId: candidateId,
            jobProfileId: jobId,
          }),
        }
      );
      setPositioning(brief);
      toast.success("Positioning brief ready", {
        description: "It now shapes every answer for this role.",
      });
    } catch (err) {
      toast.error("Could not build positioning brief", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBriefBuilding(false);
    }
  }, [candidateId, jobId]);

  const windowMs = (settings.transcriptWindowSeconds || 90) * 1000;

  const recentTranscript = React.useCallback(() => {
    const cutoff = Date.now() - windowMs;
    const recentFinals = finalsRef.current
      .filter((f) => f.at >= cutoff)
      .map((f) => f.text);
    // Safety net: collapse any repeated phrases that slipped past the caption
    // reconciler (e.g. from the PowerShell bridge concatenating overlapping
    // caption blocks) before the transcript reaches the model or the screen.
    return collapseRepeatedText(
      [...recentFinals, interimRef.current].join(" ").trim()
    );
  }, [windowMs]);

  // A tighter slice (last few sentences) sent to the answer model for speed.
  const recentForAnswer = React.useCallback(
    () => lastSentences(recentTranscript(), 6),
    [recentTranscript]
  );

  const selectedJob = jobs.find((j) => j.id === jobId) ?? null;

  /* ------------------------------ Memory ------------------------------ */

  const pushPriorTurn = React.useCallback((question: string, body: string) => {
    const q = question.trim();
    if (!q) return;
    const turn: PriorTurnState = { question: q, answerGist: answerGist(body) };
    priorTurnsRef.current = [
      ...priorTurnsRef.current.filter((t) => t.question !== q),
      turn,
    ].slice(-8);
  }, []);

  const appendLog = React.useCallback((result: AnswerResult) => {
    setLog((prev) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: result.detected_question.trim() || "(question inferred)",
        answer: result.answer,
        confidence: result.confidence,
        at: Date.now(),
      };
      const next = [entry, ...prev];
      return next.length > MAX_LOG ? next.slice(0, MAX_LOG) : next;
    });
  }, []);

  /* ----------------------------- Delta input ----------------------------- */

  // What to answer next: only the speech that's new since the last answer, plus
  // a couple of sentences of overlap for context. This is the core fix for
  // "question detection is bad / scripts duplicated" — we stop re-feeding the
  // whole rolling window on every Generate.
  const buildDelta = React.useCallback(() => {
    const all = finalsRef.current;
    const fresh = all.filter((f) => f.seq > consumedSeqRef.current);
    let newText = collapseRepeatedText(
      [...fresh.map((f) => f.text), interimRef.current].join(" ").trim()
    );
    if (consumedInterimRef.current) {
      newText = stripLeadingOverlap(newText, consumedInterimRef.current);
    }
    const consumedText = all
      .filter((f) => f.seq <= consumedSeqRef.current)
      .map((f) => f.text)
      .join(" ");
    const context = lastSentences(consumedText, 2);
    const maxSeq = fresh.length
      ? fresh[fresh.length - 1].seq
      : consumedSeqRef.current;
    return { newText, context, maxSeq };
  }, []);

  /* --------------------------- Generation --------------------------- */

  // Shared streaming driver for both Generate and Rewrite. Seeds an empty
  // answer, streams Markdown deltas into it live, then parses the trailing
  // metadata. Aborts any earlier in-flight stream.
  //
  // Outcome:
  //  - "answer"     -> a real answer was produced
  //  - "no_answer"  -> the model decided there was nothing to answer (NO_ANSWER
  //                    sentinel); the prior answer is left on screen untouched
  //  - "superseded" -> a newer run replaced this one (aborted); stay silent
  const streamAnswer = React.useCallback(
    async (
      url: string,
      payload: Record<string, unknown>,
      knownQuestion: string
    ): Promise<StreamOutcome> => {
      streamAbort.current?.abort();
      const controller = new AbortController();
      streamAbort.current = controller;
      // Snapshot the currently-shown answer so a NO_ANSWER run can restore it
      // instead of blanking the card.
      const previous = answerRef.current;
      setGenerating(true);
      setAnswer((prev) => ({
        detected_question: knownQuestion || prev?.detected_question || "",
        answer: "",
        keywords: [],
        confidence: "medium",
        risk_note: "",
        possible_follow_up: "",
      }));

      try {
        const full = await streamFetch(
          url,
          { method: "POST", body: JSON.stringify(payload), signal: controller.signal },
          (acc) => {
            const { body } = parseAnswerStream(acc);
            // While the model is emitting the NO_ANSWER sentinel, keep the
            // loading shimmer instead of flashing the raw token.
            const shown = looksLikeNoAnswer(body) ? "" : body;
            setAnswer((prev) => (prev ? { ...prev, answer: shown } : prev));
          }
        );

        const { body, meta, error } = parseAnswerStream(full);
        if (error) throw new Error(error);

        if (isNoAnswerBody(body)) {
          // Nothing to answer — put the previous answer back so the screen
          // doesn't blank out on a passing remark.
          setAnswer(previous);
          return { kind: "no_answer" };
        }

        const finalQuestion = knownQuestion || meta?.detected_question || "";
        // Prefer the model's own risk note; otherwise fall back to a local,
        // no-latency style check that flags banned corporate filler.
        const riskNote = (meta?.risk_note ?? "").trim() || styleRiskNote(body);
        const result: AnswerResult = {
          detected_question: finalQuestion,
          answer: body,
          keywords: meta?.keywords ?? [],
          confidence: meta?.confidence ?? "medium",
          risk_note: riskNote,
          possible_follow_up: meta?.possible_follow_up ?? "",
        };
        setAnswer(result);
        return { kind: "answer", result };
      } catch (err) {
        // A superseded stream aborts intentionally — stay silent.
        if (controller.signal.aborted) return { kind: "superseded" };
        throw err;
      } finally {
        if (streamAbort.current === controller) {
          streamAbort.current = null;
          setGenerating(false);
        }
      }
    },
    []
  );

  const generate = React.useCallback(
    async (
      mode: AnswerMode,
      opts: { override?: string; wide?: boolean; auto?: boolean } = {}
    ) => {
      const question = (opts.override ?? detectedRef.current).trim();

      // Decide what to send, and whether to advance the "answered up to here"
      // marker. We hand the model two distinct things:
      //   focusHint  -> the interviewer's latest words, i.e. what to ANSWER
      //   transcript -> earlier speech, only as background to interpret it
      let transcript = "";
      let focusHint = "";
      let advanceTo: number | null = null;
      // Interim snapshot at the moment we build the delta, committed on success
      // so the next delta can strip it once it finalizes.
      let interimSnapshot = "";

      if (question) {
        // Explicit typed question: it IS the ask. Send recent speech as context.
        transcript = recentForAnswer();
      } else if (opts.wide) {
        // Regenerate / recovery: re-read a wider window and ignore the marker so
        // a wrong boundary or mis-click can be corrected. Point at the tail.
        transcript = lastSentences(recentTranscript(), 8);
        focusHint = latestUtterance(transcript);
      } else {
        // Normal flow: the interviewer's latest TURN is everything new since the
        // last answer. Hand that WHOLE turn to the model as the thing to answer
        // (so a long, multi-question turn gets each part answered), with a
        // little earlier speech as background only. This is the core of "send
        // the last part as raw script, get back the question(s) + answer".
        const { newText, context, maxSeq } = buildDelta();
        if (newText) {
          focusHint = newText;
          transcript = context; // earlier background only (may be empty)
          advanceTo = maxSeq;
          interimSnapshot = interimRef.current.trim();
        } else if (opts.auto) {
          // Auto-answer with nothing new to say: do nothing (no re-answering).
          return;
        } else {
          // Manual click with nothing new: best-effort answer of the recent
          // window. Harmless, and the marker is left alone.
          transcript = recentForAnswer();
          focusHint = latestUtterance(transcript);
        }
      }

      if (!question && !transcript && !focusHint) {
        toast.error("Nothing to answer yet", {
          description: "Record/paste some transcript, or type a question.",
        });
        return;
      }
      setLastMode(mode);
      try {
        const outcome = await streamAnswer(
          "/api/generate-answer/stream",
          {
            candidateProfileId: candidateId || undefined,
            jobProfileId: jobId || undefined,
            recentTranscript: transcript,
            detectedQuestion: question,
            focusHint,
            questionType,
            answerMode: mode,
            interviewStage,
            answerLanguage: settings.answerLanguage,
            maxSentences: settings.maxSentences,
            boldKeywords: settings.boldKeywords,
            allowInventedDetails: settings.allowInventedDetails,
            priorTurns: priorTurnsRef.current,
          },
          question
        );
        if (outcome.kind === "superseded") return; // a newer generate replaced this
        if (outcome.kind === "no_answer") {
          // The model judged there's nothing to answer. Don't advance the
          // marker (so a real ask in the growing delta still gets picked up),
          // don't log it. Only nudge the user when they asked explicitly.
          if (!opts.auto) {
            toast("Nothing to answer there", {
              description: "The latest speech didn't look like a question yet.",
            });
          }
          setQuestionReady(false);
          return;
        }
        const result = outcome.result;
        // Advance the consumed marker only when we actually answered a fresh
        // delta, so the next Generate won't re-answer this text.
        if (advanceTo !== null) {
          prevConsumedSeqRef.current = consumedSeqRef.current;
          consumedSeqRef.current = advanceTo;
          consumedInterimRef.current = interimSnapshot;
        }
        // NOTE: never write the inferred question back into the override box —
        // doing so makes it "stick" and forces every later answer onto a stale
        // question. The box only ever holds what the user types.
        const answered = result.detected_question.trim() || question;
        lastAnsweredRef.current = answered;
        pushPriorTurn(answered, result.answer);
        appendLog(result);
        setQuestionReady(false);
      } catch (err) {
        toast.error("Could not generate answer", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [
      candidateId,
      jobId,
      questionType,
      interviewStage,
      recentForAnswer,
      recentTranscript,
      buildDelta,
      settings,
      streamAnswer,
      pushPriorTurn,
      appendLog,
    ]
  );

  const rewrite = React.useCallback(
    async (mode: AnswerMode) => {
      // If there's no answer yet, generating in that mode is the right behavior.
      if (!answer || !answer.answer.trim()) {
        await generate(mode);
        return;
      }
      setLastMode(mode);
      const baseQuestion = detectedRef.current.trim() || answer.detected_question;
      try {
        await streamAnswer(
          "/api/rewrite-answer/stream",
          {
            detectedQuestion: baseQuestion || answer.answer.slice(0, 80),
            answer: answer.answer,
            answerMode: mode,
            interviewStage,
            answerLanguage: settings.answerLanguage,
            candidateProfileId: candidateId || undefined,
            jobProfileId: jobId || undefined,
            maxSentences: settings.maxSentences,
            boldKeywords: settings.boldKeywords,
          },
          baseQuestion
        );
      } catch (err) {
        toast.error("Could not rewrite answer", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
    [answer, generate, candidateId, jobId, interviewStage, settings, streamAnswer]
  );

  /* --------------------------- Live transcript --------------------------- */

  const handleTranscript = React.useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      if (!text.trim()) return;
      setFinals((prev) => {
        const next = [...prev, { text, at: Date.now(), seq: ++seqRef.current }];
        return next.length > MAX_FINALS ? next.slice(-MAX_FINALS) : next;
      });
      setInterim("");
    } else {
      setInterim(text);
    }
  }, []);

  // Keep the transcript scrolled to the newest line.
  const transcriptScrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = transcriptScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finals, interim]);

  const [captureSource, setCaptureSource] = React.useState<CaptureChoice>("microphone");

  // Live Captions is only available in the Windows desktop build. Resolved
  // after mount to avoid a hydration mismatch.
  const [liveCaptionsAvailable, setLiveCaptionsAvailable] = React.useState(false);
  React.useEffect(() => {
    const api = getElectronAPI();
    setLiveCaptionsAvailable(Boolean(api) && api?.platform === "win32");
  }, []);

  const deepgram = useDeepgram({
    onTranscript: handleTranscript,
    onError: (message) =>
      toast.error("Transcription error", { description: message }),
    language: settings.sttLanguage,
  });

  const openaiStt = useOpenAiTranscription({
    onTranscript: handleTranscript,
    onError: (message) =>
      toast.error("Transcription error", { description: message }),
    segmentMs: Math.max(2, settings.sttSegmentSeconds || 4) * 1000,
    language: settings.sttLanguage,
  });

  const liveCaptions = useLiveCaptions({
    onTranscript: handleTranscript,
    onError: (message) =>
      toast.error("Live Captions error", { description: message }),
  });

  // Engine selection: Live Captions when chosen; Deepgram streams the mic when
  // available; otherwise (and always for shared tab/system audio) OpenAI
  // transcribes short segments.
  const isLiveCaptions = captureSource === "livecaption";
  const useDeepgramEngine =
    !isLiveCaptions &&
    Boolean(config?.deepgramConfigured) &&
    captureSource === "microphone";

  const isRecording =
    deepgram.isRecording || openaiStt.isRecording || liveCaptions.isRecording;
  const isStarting =
    deepgram.state === "connecting" || openaiStt.state === "starting";

  const startRecording = React.useCallback(() => {
    if (isLiveCaptions) {
      liveCaptions.start();
    } else if (useDeepgramEngine) {
      void deepgram.start();
    } else if (config?.openaiConfigured) {
      void openaiStt.start(captureSource as CaptureSource);
    } else {
      toast.error("No transcription available", {
        description: "Add an OpenAI key on Settings to enable live transcription.",
      });
    }
  }, [
    isLiveCaptions,
    useDeepgramEngine,
    config?.openaiConfigured,
    captureSource,
    deepgram,
    openaiStt,
    liveCaptions,
  ]);

  const stopRecording = React.useCallback(() => {
    deepgram.stop();
    openaiStt.stop();
    liveCaptions.stop();
  }, [deepgram, openaiStt, liveCaptions]);

  // End-of-turn detection: any new speech (final or interim) resets a short
  // timer. When the interviewer pauses, the timer fires — that's the moment to
  // answer. No "?" required, and no separate detection call on the hot path.
  // How long the interviewer must pause (no new captions) before we treat it as
  // the end of their turn — the moment to answer. Works for questions and for
  // prompts that don't end in "?" ("Tell me about a time you led a project").
  const endOfTurnMs = Math.round(
    Math.max(0.5, settings.endOfTurnSeconds || 1.8) * 1000
  );

  React.useEffect(() => {
    if (!isRecording) return;
    // They're talking again, so it's not the moment yet.
    setQuestionReady(false);
    if (endOfTurnTimer.current) clearTimeout(endOfTurnTimer.current);
    endOfTurnTimer.current = setTimeout(
      () => handleEndOfTurnRef.current(),
      endOfTurnMs
    );
    return () => {
      if (endOfTurnTimer.current) clearTimeout(endOfTurnTimer.current);
    };
  }, [finals, interim, isRecording, endOfTurnMs]);

  const addManualCaption = () => {
    const text = manualCaption.trim();
    if (!text) return;
    setFinals((prev) => [...prev, { text, at: Date.now(), seq: ++seqRef.current }]);
    setManualCaption("");
  };

  const clearTranscript = () => {
    setFinals([]);
    setInterim("");
    finalsRef.current = [];
    interimRef.current = "";
    seqRef.current = 0;
    consumedSeqRef.current = 0;
    prevConsumedSeqRef.current = 0;
    consumedInterimRef.current = "";
    lastAnsweredRef.current = "";
    priorTurnsRef.current = [];
    setQuestionReady(false);
    toast.success("Transcript cleared");
  };

  /* ------------------------------ Save turn ------------------------------ */

  const ensureSession = React.useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const title =
      sessionTitle.trim() ||
      `${selectedJob?.company ?? "Interview"} — ${new Date().toLocaleDateString()}`;
    const session = await apiFetch<{ id: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        title,
        candidateProfileId: candidateId || null,
        jobProfileId: jobId || null,
      }),
    });
    setSessionId(session.id);
    setSessionTitle(title);
    return session.id;
  }, [sessionId, sessionTitle, selectedJob, candidateId, jobId]);

  const saveTurn = React.useCallback(async () => {
    if (!answer) {
      toast.error("Generate an answer before saving the turn.");
      return;
    }
    setSaving(true);
    try {
      const id = await ensureSession();
      await apiFetch(`/api/sessions/${id}/turns`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: id,
          rawTranscript: recentTranscript(),
          detectedQuestion: answer.detected_question || detectedRef.current,
          questionType,
          generatedAnswer: answer.answer,
          answerMode: lastMode,
          interviewStage,
          keywords: answer.keywords,
          confidence: answer.confidence,
          riskNote: answer.risk_note,
          possibleFollowUp: answer.possible_follow_up,
        }),
      });
      // Persist the running transcript on the session too.
      await apiFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          transcript: finalsRef.current.map((f) => f.text).join("\n"),
        }),
      });
      toast.success("Turn saved", { description: "View it later on the History page." });
    } catch (err) {
      toast.error("Could not save turn", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }, [answer, ensureSession, recentTranscript, questionType, lastMode, interviewStage]);

  /* --------------------------- Keyboard shortcuts --------------------------- */

  const generateRef = React.useRef(generate);
  const rewriteRef = React.useRef(rewrite);
  generateRef.current = generate;
  rewriteRef.current = rewrite;
  const lastModeRef = React.useRef(lastMode);
  lastModeRef.current = lastMode;
  const generatingRef = React.useRef(generating);
  generatingRef.current = generating;
  const autoAnswerRef = React.useRef(autoAnswer);
  autoAnswerRef.current = autoAnswer;

  // Runs when the interviewer pauses (end of turn). In auto mode it generates a
  // one-shot answer (the model infers the question itself); otherwise it just
  // signals that now is a good time to press Generate — no LLM call, no waiting.
  handleEndOfTurnRef.current = () => {
    if (generatingRef.current) return;
    // Only react when there's genuinely new speech since the last answer.
    const { newText } = buildDelta();
    if (!newText) return;
    if (autoAnswerRef.current) {
      void generateRef.current(lastModeRef.current, { auto: true });
    } else {
      setReadyConfidence("");
      setQuestionReady(true);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (!e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        void generateRef.current(settings.defaultAnswerMode);
        return;
      }
      if (e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === "s") {
          e.preventDefault();
          void rewriteRef.current("shorter");
        } else if (key === "t") {
          e.preventDefault();
          void rewriteRef.current("technical");
        } else if (key === "h") {
          e.preventDefault();
          void rewriteRef.current("human");
        } else if (key === "r") {
          e.preventDefault();
          void generateRef.current(lastModeRef.current, { wide: true });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settings.defaultAnswerMode]);

  // Global hotkey from the Electron overlay (works even when the call is focused).
  React.useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    return api.onGenerate(() => {
      void generateRef.current(settings.defaultAnswerMode);
    });
  }, [settings.defaultAnswerMode]);

  // Global hotkey (Ctrl/Cmd+Shift+C) to toggle the live-coding copilot.
  React.useEffect(() => {
    const api = getElectronAPI();
    if (!api?.coding) return;
    return api.coding.onToggle(() => setCodingOpen((v) => !v));
  }, []);

  const openaiMissing = config && !config.openaiConfigured;

  return (
    <div className="space-y-4">
      {codingOpen && (
        <CodingPanel
          onClose={() => setCodingOpen(false)}
          candidateId={candidateId || undefined}
          getTranscript={recentTranscript}
        />
      )}
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Live session</h1>
          <p className="text-sm text-muted-foreground">
            Capture the interviewer and stream a spoken answer in real time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={codingOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setCodingOpen((v) => !v)}
            title="Live-coding copilot (Ctrl/Cmd+Shift+C)"
          >
            <Code2 className="h-4 w-4" /> Coding
          </Button>
          <SessionStatus sessionId={sessionId} recording={isRecording} />
        </div>
      </div>

      {openaiMissing && (
        <Banner>
          OpenAI API key is not configured. Add <code>OPENAI_API_KEY</code> to your{" "}
          <code>.env</code> to enable live answers.
        </Banner>
      )}

      {/* Context selectors */}
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Candidate profile</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 && (
                  <SelectItem value="none" disabled>
                    No profiles — add one on Setup
                  </SelectItem>
                )}
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || "Unnamed"} — {c.targetTitle || "candidate"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Job profile</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {jobs.length === 0 && (
                  <SelectItem value="none" disabled>
                    No jobs — add one on Setup
                  </SelectItem>
                )}
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.roleTitle || "Role"} @ {j.company || "company"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-title">Session title</Label>
            <Input
              id="session-title"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="e.g. Meridian — backend screen"
            />
          </div>
        </CardContent>
      </Card>

      <PositioningBriefCard
        brief={positioning}
        loading={briefLoading}
        building={briefBuilding}
        disabled={!candidateId || !jobId}
        onBuild={() => void buildBrief()}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                Live transcript
                {isRecording && (
                  <span className="flex items-center gap-1 text-xs font-normal text-destructive">
                    <span className="h-2 w-2 animate-pulse-dot rounded-full bg-destructive" />
                    recording
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                {(config?.transcriptionAvailable || liveCaptionsAvailable) && (
                  <>
                    <Select
                      value={captureSource}
                      onValueChange={(v) => setCaptureSource(v as CaptureChoice)}
                      disabled={isRecording || isStarting}
                    >
                      <SelectTrigger className="h-8 w-[170px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {liveCaptionsAvailable && (
                          <SelectItem value="livecaption">
                            Windows Live Captions
                          </SelectItem>
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
                    {isRecording ? (
                      <Button size="sm" variant="destructive" onClick={stopRecording}>
                        <Square className="h-4 w-4" /> Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={startRecording}
                        disabled={isStarting}
                      >
                        {isStarting ? (
                          <Spinner />
                        ) : captureSource === "display" ? (
                          <MonitorSpeaker className="h-4 w-4" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                        Record
                      </Button>
                    )}
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={clearTranscript}>
                  <Eraser className="h-4 w-4" /> Clear
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!config?.transcriptionAvailable && !liveCaptionsAvailable ? (
                <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  Live audio is off (no OpenAI or Deepgram key). Use the caption box below
                  to paste what the interviewer says.
                </p>
              ) : (
                <CaptureHint
                  source={captureSource}
                  engine={
                    isLiveCaptions
                      ? "Live Captions"
                      : useDeepgramEngine
                        ? "Deepgram"
                        : "OpenAI"
                  }
                />
              )}
              <div
                ref={transcriptScrollRef}
                className="h-44 overflow-y-auto rounded-md border border-border bg-background/50 p-3 text-sm leading-relaxed scrollbar-thin"
              >
                {finals.length === 0 && !interim ? (
                  <span className="text-muted-foreground">
                    Transcript will appear here…
                  </span>
                ) : (
                  <>
                    {finals.map((f, i) => (
                      <span key={i}>{f.text} </span>
                    ))}
                    {interim && <span className="text-muted-foreground">{interim}</span>}
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-caption">Manual caption paste</Label>
                <Textarea
                  id="manual-caption"
                  value={manualCaption}
                  onChange={(e) => setManualCaption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      addManualCaption();
                    }
                  }}
                  placeholder="Paste interviewer captions, then Add (or ⌘/Ctrl+Enter)…"
                  className="min-h-[60px]"
                />
                <Button size="sm" variant="outline" onClick={addManualCaption}>
                  Add to transcript
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Ask a specific question (optional)</CardTitle>
              <CardDescription>
                Leave blank to let Generate answer whatever the interviewer just
                asked. Type here to answer one exact question instead.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={detectedQuestion}
                onChange={(e) => setDetectedQuestion(e.target.value)}
                placeholder="e.g. Walk me through a system you designed for scale…"
                className="min-h-[70px] text-base"
              />
            </CardContent>
          </Card>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          <LiveStatus
            recording={isRecording}
            transcribing={openaiStt.processing}
            generating={generating}
            questionReady={questionReady}
            readyConfidence={readyConfidence}
          />

          <Card
            className={
              questionReady && !generating
                ? "border-success/60 shadow-[0_0_0_1px_hsl(var(--success))]"
                : "border-primary/30"
            }
          >
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">Your answer</CardTitle>
              {answer && <ConfidenceBadge confidence={answer.confidence} />}
            </CardHeader>
            <CardContent className="space-y-3">
              {answer?.detected_question && (
                <div className="rounded-md border-l-2 border-primary/50 bg-secondary/30 px-3 py-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Question
                  </p>
                  <p className="text-sm font-semibold leading-snug">
                    {answer.detected_question}
                  </p>
                </div>
              )}
              <div
                className={`min-h-[96px] rounded-md bg-secondary/40 p-2.5 leading-relaxed ${
                  ANSWER_FONT_SIZE_CLASS[settings.answerFontSize] ?? "text-base"
                }`}
              >
                {answer && answer.answer ? (
                  <RichAnswer text={answer.answer} />
                ) : generating ? (
                  <GeneratingState />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Generate an answer with ⌘/Ctrl + Enter, or the buttons below.
                  </span>
                )}
              </div>

              {answer?.risk_note && (
                <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{answer.risk_note}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">Controls</CardTitle>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                Auto-answer
                <Switch checked={autoAnswer} onCheckedChange={setAutoAnswer} />
              </label>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Interview stage</Label>
                <Select
                  value={interviewStage}
                  onValueChange={(v) => setInterviewStage(v as InterviewStage)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {interviewStageSchema.options.map((s) => (
                      <SelectItem key={s} value={s}>
                        {INTERVIEW_STAGE_LABELS[s]} — {INTERVIEW_STAGE_HINTS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void generate(settings.defaultAnswerMode)}
                  disabled={generating}
                  className={questionReady && !generating ? "animate-pulse-dot" : ""}
                >
                  <Sparkles className="h-4 w-4" /> Generate
                </Button>
                <Button variant="outline" onClick={() => void rewrite("shorter")} disabled={generating}>
                  Shorter
                </Button>
                <Button variant="outline" onClick={() => void rewrite("more_senior")} disabled={generating}>
                  More senior
                </Button>
                <Button variant="outline" onClick={() => void rewrite("star")} disabled={generating}>
                  STAR
                </Button>
                <Button variant="outline" onClick={() => void rewrite("technical")} disabled={generating}>
                  Technical
                </Button>
                <Button variant="outline" onClick={() => void rewrite("human")} disabled={generating}>
                  Human
                </Button>
                <Button variant="outline" onClick={() => void rewrite("safer")} disabled={generating}>
                  Safer
                </Button>
                <Button variant="outline" onClick={() => void generate("follow_up")} disabled={generating}>
                  Predict follow-up
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => void generate(lastMode, { wide: true })}
                  disabled={generating}
                >
                  <RefreshCw className="h-4 w-4" /> Regenerate
                </Button>
                <Button variant="secondary" onClick={() => void saveTurn()} disabled={saving || !answer}>
                  {saving ? <Spinner /> : <Save className="h-4 w-4" />} Save turn
                </Button>
              </div>
            </CardContent>
          </Card>

          {log.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm">Answer log ({log.length})</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setLog([])}
                >
                  Clear
                </Button>
              </CardHeader>
              <CardContent className="max-h-72 space-y-1.5 overflow-y-auto">
                {log.map((e) => (
                  <details
                    key={e.id}
                    className="group rounded-md border border-border bg-secondary/20 px-2.5 py-1.5"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                      <span className="line-clamp-1 font-medium">{e.question}</span>
                    </summary>
                    <div className="mt-1.5 border-t border-border pt-1.5 text-sm">
                      <RichAnswer text={e.answer} />
                    </div>
                  </details>
                ))}
              </CardContent>
            </Card>
          )}

          <ShortcutHint />
        </div>
      </div>
    </div>
  );
}

function SessionStatus({
  sessionId,
  recording,
}: {
  sessionId: string | null;
  recording: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          recording ? "animate-pulse-dot bg-destructive" : sessionId ? "bg-success" : "bg-muted-foreground/50"
        }`}
      />
      <span className="text-muted-foreground">
        {recording ? "Recording" : sessionId ? "Session active" : "Not started"}
      </span>
    </div>
  );
}

// The model emits the bare token NO_ANSWER (with no ---META--- block) when the
// latest interviewer turn isn't actually something to answer. Detect it
// defensively, tolerating stray leading markdown emphasis.
const NO_ANSWER_TOKEN = "NO_ANSWER";

function normalizeSentinel(body: string): string {
  return body.trim().replace(/^[*_`>#\s]+/, "").toUpperCase();
}

function isNoAnswerBody(body: string): boolean {
  return normalizeSentinel(body).startsWith(NO_ANSWER_TOKEN);
}

// During streaming, also treat an in-progress prefix of the token (e.g. "NO_")
// as the sentinel, so the raw token never flashes on screen before the run
// finishes. A real answer that merely starts with "No" diverges from the token
// quickly (e.g. "No," vs "NO_ANSWER") and renders normally.
function looksLikeNoAnswer(body: string): boolean {
  const s = normalizeSentinel(body);
  return s.length > 0 && (s.startsWith(NO_ANSWER_TOKEN) || NO_ANSWER_TOKEN.startsWith(s));
}

function PositioningBriefCard({
  brief,
  loading,
  building,
  disabled,
  onBuild,
}: {
  brief: PositioningBrief | null;
  loading: boolean;
  building: boolean;
  disabled: boolean;
  onBuild: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4" /> Positioning brief
            {brief && !building && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
                Active
              </span>
            )}
          </CardTitle>
          <CardDescription>
            One-time strategy for this candidate + role. It shapes every answer automatically.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant={brief ? "outline" : "default"}
          onClick={onBuild}
          disabled={disabled || building}
        >
          {building ? <Spinner /> : <Sparkles className="h-4 w-4" />}
          {brief ? "Rebuild" : "Build brief"}
        </Button>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <p className="text-sm text-muted-foreground">
            Pick a candidate and a job profile to build a brief.
          </p>
        ) : building ? (
          <p className="text-sm text-muted-foreground">
            Analyzing resume + JD to build your positioning…
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : brief ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <span className="font-medium">
                {brief.headline || "View positioning"}
              </span>
            </summary>
            <div className="mt-3 space-y-4 border-t border-border pt-3 text-sm">
              {brief.signature_projects.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Signature projects
                  </p>
                  {brief.signature_projects.map((p: BriefProject, i: number) => (
                    <div
                      key={i}
                      className="rounded-md border border-border bg-secondary/20 px-2.5 py-2"
                    >
                      <p className="font-medium">
                        {p.title || "Project"}
                        {p.what ? <span className="font-normal text-muted-foreground"> — {p.what}</span> : null}
                      </p>
                      {p.contributions.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {p.contributions.map((c, ci) => (
                            <li key={ci}>{c}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {p.tech.length > 0 && <span>Tech: {p.tech.join(", ")}</span>}
                        {p.impact.length > 0 && <span>Impact: {p.impact.join("; ")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <BriefList label="Why you fit" items={brief.why_fit} />
              {brief.prepared_answers.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Prepared answers
                  </p>
                  {brief.prepared_answers.map((qa: BriefQa, i: number) => (
                    <div key={i}>
                      {qa.question && <p className="font-medium">{qa.question}</p>}
                      <p className="text-muted-foreground">{qa.answer}</p>
                    </div>
                  ))}
                </div>
              )}
              {brief.weak_spots.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Weak spots
                  </p>
                  <ul className="space-y-1">
                    {brief.weak_spots.map((w: WeakSpot, i: number) => (
                      <li key={i} className="text-muted-foreground">
                        <span className="font-medium text-foreground">{w.concern}</span>
                        {w.how_to_handle ? ` — ${w.how_to_handle}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">
            No brief yet. Build one so answers stay specific and on-message for this role.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BriefList({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** Return the last `n` sentences from a transcript, for a tighter prompt. */
function lastSentences(text: string, n: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  if (!sentences || sentences.length <= n) return trimmed;
  return sentences.slice(-n).join(" ").trim();
}

// The interviewer's latest utterance — a soft focus hint sent alongside the
// transcript so the model answers the most recent ask, not something stale.
// Prefers the last sentence; if that sentence is short (likely a terse
// question that needs its setup), include the one before it too.
function latestUtterance(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  if (!sentences || sentences.length === 0) return trimmed;
  const tail = sentences.slice(-2).map((s) => s.trim());
  const last = tail[tail.length - 1];
  if (tail.length === 2 && last.split(/\s+/).length <= 7) {
    return tail.join(" ");
  }
  return last;
}

// Remove the leading words of `text` that are already covered by `consumed` (a
// previously answered interim that has since finalized into a final chunk).
// Word-level longest common prefix on a normalized form, so Live Captions
// revisions only cost a small partial overlap instead of a full re-answer.
function stripLeadingOverlap(text: string, consumed: string): string {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const t = text.trim().split(/\s+/).filter(Boolean);
  const c = consumed.trim().split(/\s+/).filter(Boolean);
  if (t.length === 0 || c.length === 0) return text.trim();
  let k = 0;
  const max = Math.min(t.length, c.length);
  while (k < max && norm(t[k]) === norm(c[k]) && norm(t[k]) !== "") k++;
  return t.slice(k).join(" ");
}

function CaptureHint({
  source,
  engine,
}: {
  source: CaptureChoice;
  engine: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        {source === "livecaption" && (
          <>
            Reads <strong>Windows 11 Live Captions</strong> on-device (no API cost, very low
            latency). Enable it once with <strong>Win + Ctrl + L</strong> and set Live Captions
            to caption system audio so it hears the interviewer. Captions are mixed (not split
            by speaker), which is fine for detecting the latest question.
          </>
        )}
        {source === "microphone" && (
          <>
            Captures your <strong>microphone</strong> via <strong>{engine}</strong>. This only
            hears the interviewer if they’re on a loudspeaker — to capture their voice, use
            “Meeting tab audio” or “Mic + meeting audio”.
          </>
        )}
        {source === "display" && (
          <>
            Captures audio from a shared tab/window/screen via <strong>{engine}</strong>. For{" "}
            <strong>Google Meet / Zoom in the browser</strong>, share that tab and tick “Share
            tab audio”. For the <strong>desktop apps</strong>, share your <em>whole screen</em>{" "}
            with system audio, or route audio through a virtual loopback device (BlackHole on
            macOS, VB-Cable on Windows). This captures the interviewer but not your mic.
          </>
        )}
        {source === "both" && (
          <>
            Captures <strong>your mic + the shared meeting audio</strong> mixed together via{" "}
            <strong>{engine}</strong>, so the transcript includes both you and the interviewer.
            When prompted, share the meeting tab (tick “Share tab audio”) or your whole screen
            with system audio. Tip: use headphones to avoid echo.
          </>
        )}
      </p>
    </div>
  );
}

function LiveStatus({
  recording,
  transcribing,
  generating,
  questionReady,
  readyConfidence,
}: {
  recording: boolean;
  transcribing: boolean;
  generating: boolean;
  questionReady: boolean;
  readyConfidence: string;
}) {
  let dot = "bg-muted-foreground/50";
  let text = "Idle — record audio or paste a caption";
  let tone = "text-muted-foreground";
  let pulse = false;

  if (generating) {
    dot = "bg-primary";
    text = "Generating answer…";
    tone = "text-foreground";
    pulse = true;
  } else if (questionReady) {
    dot = "bg-success";
    text = readyConfidence
      ? `Question ready (${readyConfidence}) — press ⌘/Ctrl + Enter`
      : "They paused — press ⌘/Ctrl + Enter to answer";
    tone = "text-success";
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
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
      <span
        className={`h-2.5 w-2.5 rounded-full ${dot} ${pulse ? "animate-pulse-dot" : ""}`}
      />
      <span className={tone}>{text}</span>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="space-y-2">
      <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-5 w-full animate-pulse rounded bg-muted" />
      <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function ShortcutHint() {
  const shortcuts = [
    ["⌘/Ctrl + Enter", "Generate"],
    ["⌘/Ctrl + Shift + S", "Shorter"],
    ["⌘/Ctrl + Shift + T", "Technical"],
    ["⌘/Ctrl + Shift + H", "Human"],
    ["⌘/Ctrl + Shift + R", "Regenerate"],
  ];
  return (
    <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
      <p className="mb-2 flex items-center gap-1.5 font-medium">
        <Keyboard className="h-3.5 w-3.5" /> Shortcuts
      </p>
      <div className="grid grid-cols-2 gap-1">
        {shortcuts.map(([keys, label]) => (
          <div key={keys} className="flex items-center justify-between gap-2">
            <span>{label}</span>
            <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
