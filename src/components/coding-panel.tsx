"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  X,
  Camera,
  MonitorUp,
  Sparkles,
  Square,
  Trash2,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Clipboard,
  History,
  ArrowLeft,
  MessageSquare,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichAnswer } from "@/components/rich-answer";
import { getElectronAPI } from "@/lib/electron";
import { CODING_LANGUAGE_LABELS } from "@/lib/prompts";
import {
  CODING_MODE_LABELS,
  hasCodingContent,
  fullCode,
  type CodingMode,
} from "@/lib/coding";
import { useCoding, type CodingModeChoice } from "@/hooks/use-coding";

const MODE_OPTIONS: Array<{ value: CodingModeChoice; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "new", label: "Solve" },
  { value: "fix", label: "Fix bug" },
  { value: "optimize", label: "Optimize" },
  { value: "explain", label: "Explain" },
  { value: "test", label: "Dry run" },
  { value: "answer", label: "Verbal" },
];

function modeBadgeVariant(mode: CodingMode | null) {
  if (mode === "fix") return "warning" as const;
  if (mode === "answer" || mode === "explain") return "secondary" as const;
  return "default" as const;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CodingPanel({
  onClose,
  candidateId,
  getTranscript,
}: {
  onClose: () => void;
  candidateId?: string;
  getTranscript?: () => string;
}) {
  const c = useCoding({ candidateId, getTranscript });
  const {
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
    solving,
    error,
    solve,
    stop,
    newProblem,
    history,
    activeTurnId,
    selectTurn,
    viewingHistory,
    displayedSolution,
    displayedImages,
  } = c;

  const [showPaste, setShowPaste] = React.useState(false);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (canNativeCapture) void refreshSources();
  }, [canNativeCapture, refreshSources]);

  // Global "capture" hotkey from the Electron shell.
  React.useEffect(() => {
    const api = getElectronAPI();
    if (!api?.coding) return;
    return api.coding.onCapture(() => void capture());
  }, [capture]);

  // Local shortcuts: Esc to close, Cmd/Ctrl+Enter to solve.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void solve();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, solve]);

  const handleCapture = React.useCallback(async () => {
    try {
      if (canNativeCapture) await capture();
      else await captureViaDisplayMedia();
    } catch (err) {
      toast.error("Capture failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [canNativeCapture, capture, captureViaDisplayMedia]);

  const handlePaste = React.useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          try {
            addImage(await fileToDataUrl(file));
          } catch {
            toast.error("Could not read the pasted image.");
          }
        }
        return;
      }
      const text = e.clipboardData?.getData("text");
      if (text && !showPaste) {
        setShowPaste(true);
        setPastedText((prev) => (prev ? `${prev}\n${text}` : text));
      }
    },
    [addImage, setPastedText, showPaste]
  );

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      for (const file of Array.from(files ?? [])) {
        if (file.type.startsWith("image/")) addImage(await fileToDataUrl(file));
      }
    },
    [addImage]
  );

  const copyAll = React.useCallback(async () => {
    if (!displayedSolution) return;
    const ok = await copyText(fullCode(displayedSolution));
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } else {
      toast.error("Couldn't copy to clipboard.");
    }
  }, [displayedSolution]);

  const sol = displayedSolution;
  const showResult = sol && hasCodingContent(sol);
  const hasSteps = (sol?.steps.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/97 backdrop-blur-sm"
      onPaste={handlePaste}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <MonitorUp className="h-4 w-4 text-primary" />
          Coding copilot
        </span>

        {canNativeCapture && (
          <Select value={sourceId} onValueChange={setSourceId} disabled={loadingSources}>
            <SelectTrigger className="h-8 w-[190px]">
              <SelectValue placeholder={loadingSources ? "Loading…" : "Pick screen"} />
            </SelectTrigger>
            <SelectContent>
              {sources.length === 0 && (
                <SelectItem value="none" disabled>
                  No sources found
                </SelectItem>
              )}
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.id.startsWith("screen") ? "🖥 " : "🪟 "}
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: left inputs + history · main answer */}
      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <div className="flex w-[248px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleCapture} className="flex-1">
              <Camera className="h-4 w-4" /> Capture
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              title="Add an image file"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>

          <p className="text-[11px] leading-tight text-muted-foreground">
            {canNativeCapture
              ? "Capture the shared screen (⌘/Ctrl+Shift+2). Add several for scrolled or multi-part problems. The copilot stays hidden from the capture."
              : "Paste a screenshot (⌘/Ctrl+V), add an image, or capture the screen."}
          </p>

          {/* Thumbnails (editable when live; read-only when viewing history) */}
          {displayedImages.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {(viewingHistory
                ? displayedImages.map((dataUrl, i) => ({ id: `h-${i}`, dataUrl }))
                : images
              ).map((img, i) => (
                <div key={img.id} className="group relative overflow-hidden rounded border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={`Capture ${i + 1}`} className="h-16 w-full object-cover" />
                  {!viewingHistory && (
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute right-0.5 top-0.5 rounded bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* What the interviewer asked — visible + editable, not silently pulled */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Interviewer asked
              </label>
              {getTranscript && (
                <button
                  className="text-[11px] text-primary hover:underline"
                  onClick={() => {
                    const t = pullAsk();
                    if (!t) toast("No transcript yet to pull.");
                  }}
                  title="Fill from the live transcript"
                >
                  Pull latest
                </button>
              )}
            </div>
            <Textarea
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Optional — e.g. “now optimize it” or “what’s the complexity?”"
              className="min-h-[52px] text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Language</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CODING_LANGUAGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Mode</label>
              <Select value={mode} onValueChange={(v) => setMode(v as CodingModeChoice)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="justify-start px-2 text-muted-foreground"
            onClick={() => setShowPaste((v) => !v)}
          >
            <Clipboard className="h-4 w-4" /> Paste problem text
          </Button>
          {showPaste && (
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste the problem statement or your code here…"
              className="min-h-[80px] text-xs"
            />
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-1 space-y-1.5 border-t pt-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Previous answers
              </div>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => selectTurn(null)}
                    className={`w-full rounded px-2 py-1 text-left text-xs transition-colors ${
                      activeTurnId === null
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Current
                  </button>
                </li>
                {history.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => selectTurn(t.id)}
                      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors ${
                        activeTurnId === t.id
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      title={t.title}
                    >
                      {t.solution.mode && (
                        <Badge variant={modeBadgeVariant(t.solution.mode)} className="shrink-0 px-1.5 py-0">
                          {CODING_MODE_LABELS[t.solution.mode]}
                        </Badge>
                      )}
                      <span className="truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Main answer */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {viewingHistory && (
            <button
              onClick={() => selectTurn(null)}
              className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Viewing a previous answer — back to current
            </button>
          )}

          <div className="flex-1 space-y-4 p-4">
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {!showResult && !solving && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <MonitorUp className="h-8 w-8 opacity-40" />
                <p className="max-w-xs">
                  Capture or paste the problem, then press{" "}
                  <kbd className="rounded border px-1 text-xs">⌘/Ctrl+Enter</kbd>. You&apos;ll get
                  a step-by-step script: what to type and what to say while typing it.
                </p>
              </div>
            )}

            {/* SAY — the opening line */}
            {(solving || sol?.say) && (
              <Zone
                label="Open with"
                badge={
                  sol?.mode ? (
                    <Badge variant={modeBadgeVariant(sol.mode)}>
                      {CODING_MODE_LABELS[sol.mode]}
                    </Badge>
                  ) : null
                }
              >
                {sol?.say ? (
                  <div className="text-[15px] leading-relaxed text-foreground">
                    <RichAnswer text={sol.say} />
                  </div>
                ) : (
                  <ThinkingLine />
                )}
              </Zone>
            )}

            {/* STEPS — the type-this / say-this script */}
            {hasSteps && sol && (
              <Zone
                label={`${sol.mode === "fix" ? "Edits" : "Script"}${
                  sol.language ? ` · ${sol.language}` : ""
                }`}
                action={
                  <Button variant="ghost" size="sm" onClick={copyAll} className="h-7 px-2">
                    {copiedAll ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy all
                      </>
                    )}
                  </Button>
                }
              >
                <ol className="space-y-3">
                  {sol.steps.map((step, i) => (
                    <StepCard key={i} index={i + 1} step={step} />
                  ))}
                </ol>
              </Zone>
            )}

            {/* COMPLEXITY */}
            {sol?.complexity ? (
              <Zone label="Complexity">
                <p className="font-mono text-sm text-foreground">{sol.complexity}</p>
              </Zone>
            ) : null}

            {/* POINTS — verbal reasoning (or edge cases for code modes) */}
            {sol?.points ? (
              <Zone label={hasSteps ? "Watch for" : "Say"}>
                <div className="text-sm text-muted-foreground">
                  <RichAnswer text={sol.points} />
                </div>
              </Zone>
            ) : null}

            {/* NOTE */}
            {sol?.note ? (
              <div className="flex items-start gap-2 rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{sol.note}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {images.length > 0
            ? `${images.length} capture${images.length > 1 ? "s" : ""}`
            : "No captures yet"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={newProblem} title="Start a new problem">
            <RefreshCw className="h-4 w-4" /> New
          </Button>
          {solving ? (
            <Button variant="destructive" size="sm" onClick={stop}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => void solve()}>
              <Sparkles className="h-4 w-4" /> Solve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({ index, step }: { index: number; step: { code: string; narrate: string } }) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(async () => {
    if (await copyText(step.code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }, [step.code]);

  return (
    <li className="overflow-hidden rounded-md border">
      {/* What to SAY while typing this chunk */}
      {step.narrate && (
        <div className="flex items-start gap-2 bg-primary/5 px-3 py-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            {index}
          </span>
          <div className="flex items-start gap-1.5 text-sm leading-relaxed text-foreground">
            <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{step.narrate}</span>
          </div>
        </div>
      )}
      {/* What to TYPE */}
      {step.code && (
        <div className="group relative">
          <pre className="overflow-auto bg-muted px-3 py-2 text-[13px] leading-relaxed">
            <code className="whitespace-pre font-mono">{step.code}</code>
          </pre>
          <button
            onClick={copy}
            className="absolute right-1.5 top-1.5 rounded bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
            title="Copy this step"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </li>
  );
}

function Zone({
  label,
  badge,
  action,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        {badge}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ThinkingLine() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" /> Reading the problem…
    </div>
  );
}
