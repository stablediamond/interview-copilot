"use client";

import * as React from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { CheckCircle2, XCircle, Trash2, Moon, Sun } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OpenAiConfigCard } from "@/components/openai-config-card";
import { apiFetch } from "@/lib/client";
import { getElectronAPI } from "@/lib/electron";
import { useSettings } from "@/hooks/use-settings";
import {
  ANSWER_MODE_LABELS,
  ANSWER_FONT_SIZE_LABELS,
  ANSWER_LANGUAGES,
  INTERVIEW_STAGE_LABELS,
  STT_LANGUAGES,
  type AnswerFontSize,
} from "@/lib/constants";
import {
  answerModeSchema,
  interviewStageSchema,
  type AnswerLanguage,
  type AnswerMode,
  type InterviewStage,
} from "@/lib/schemas";
import type { ConfigStatus } from "@/lib/types";

export default function SettingsPage() {
  const { settings, update, hydrated } = useSettings();
  const { theme, setTheme } = useTheme();
  const [config, setConfig] = React.useState<ConfigStatus | null>(null);
  const [clearing, setClearing] = React.useState(false);

  const refreshConfig = React.useCallback(() => {
    apiFetch<ConfigStatus>("/api/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  React.useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const clearAll = async () => {
    if (
      !window.confirm(
        "Delete ALL local data (profiles, stories, sessions, turns)? This cannot be undone."
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await apiFetch("/api/data/reset", { method: "POST" });
      toast.success("All local data deleted");
    } catch (err) {
      toast.error("Could not delete data", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure models, answer defaults, and manage local data.
        </p>
      </div>

      {/* OpenAI key + model management */}
      <OpenAiConfigCard onChanged={refreshConfig} />

      {/* Deepgram (optional) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deepgram (optional)</CardTitle>
          <CardDescription>
            Optional low-latency streaming transcription for the microphone. Without it,
            live audio is transcribed by OpenAI instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            label="Deepgram API key"
            ok={config?.deepgramConfigured ?? false}
            optional
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnlyField
              label="Transcription model"
              value={config?.transcriptionModel ?? "—"}
            />
            <ReadOnlyField
              label="Live audio"
              value={config?.transcriptionAvailable ? "Available" : "Manual captions only"}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Set <code>DEEPGRAM_API_KEY</code> in <code>.env</code> to enable Deepgram, then
            restart the app.
          </p>
        </CardContent>
      </Card>

      {/* Answer defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Answer defaults</CardTitle>
          <CardDescription>Used by the live session and keyboard shortcuts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default answer mode</Label>
              <Select
                value={settings.defaultAnswerMode}
                onValueChange={(v) =>
                  update({ defaultAnswerMode: v as AnswerMode })
                }
                disabled={!hydrated}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {answerModeSchema.options
                    .filter((m) => m !== "follow_up")
                    .map((m) => (
                      <SelectItem key={m} value={m}>
                        {ANSWER_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default interview stage</Label>
              <Select
                value={settings.defaultInterviewStage}
                onValueChange={(v) =>
                  update({ defaultInterviewStage: v as InterviewStage })
                }
                disabled={!hydrated}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {interviewStageSchema.options.map((s) => (
                    <SelectItem key={s} value={s}>
                      {INTERVIEW_STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Answer text size</Label>
              <Select
                value={settings.answerFontSize}
                onValueChange={(v) =>
                  update({ answerFontSize: v as AnswerFontSize })
                }
                disabled={!hydrated}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(ANSWER_FONT_SIZE_LABELS) as AnswerFontSize[]
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {ANSWER_FONT_SIZE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Answer language</Label>
              <Select
                value={settings.answerLanguage}
                onValueChange={(v) =>
                  update({ answerLanguage: v as AnswerLanguage })
                }
                disabled={!hydrated}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANSWER_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-sentences">Max answer sentences</Label>
              <Input
                id="max-sentences"
                type="number"
                min={1}
                max={8}
                value={settings.maxSentences}
                onChange={(e) =>
                  update({
                    maxSentences: clamp(parseInt(e.target.value, 10) || 4, 1, 8),
                  })
                }
                disabled={!hydrated}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transcript-window">Transcript window (seconds)</Label>
              <Input
                id="transcript-window"
                type="number"
                min={15}
                max={300}
                value={settings.transcriptWindowSeconds}
                onChange={(e) =>
                  update({
                    transcriptWindowSeconds: clamp(
                      parseInt(e.target.value, 10) || 90,
                      15,
                      300
                    ),
                  })
                }
                disabled={!hydrated}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-of-turn">Answer after pause (seconds)</Label>
              <Input
                id="end-of-turn"
                type="number"
                min={0.5}
                max={5}
                step={0.1}
                value={settings.endOfTurnSeconds}
                onChange={(e) =>
                  update({
                    endOfTurnSeconds: clamp(
                      parseFloat(e.target.value) || 1.2,
                      0.5,
                      5
                    ),
                  })
                }
                disabled={!hydrated}
              />
              <p className="text-xs text-muted-foreground">
                How long the interviewer pauses before we mark the turn ready /
                auto-answer. Higher avoids cutting them off mid-question.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stt-segment">Transcription segment (seconds)</Label>
              <Input
                id="stt-segment"
                type="number"
                min={2}
                max={15}
                value={settings.sttSegmentSeconds}
                onChange={(e) =>
                  update({
                    sttSegmentSeconds: clamp(parseInt(e.target.value, 10) || 4, 2, 15),
                  })
                }
                disabled={!hydrated}
              />
              <p className="text-xs text-muted-foreground">
                OpenAI transcription only. Lower = less lag, slightly lower accuracy.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Transcription language</Label>
              <Select
                value={settings.sttLanguage}
                onValueChange={(v) => update({ sttLanguage: v })}
                disabled={!hydrated}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STT_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pinning a language is faster than auto-detect.
              </p>
            </div>
          </div>

          <ToggleRow
            label="Auto-answer on detected question"
            description="Automatically generate an answer when a clear question is detected. Default off."
            checked={settings.autoAnswer}
            onCheckedChange={(v) => update({ autoAnswer: v })}
            disabled={!hydrated}
          />
          <ToggleRow
            label="Bold keywords"
            description="Allow the model to bold key terms in answers using markdown."
            checked={settings.boldKeywords}
            onCheckedChange={(v) => update({ boldKeywords: v })}
            disabled={!hydrated}
          />
          <ToggleRow
            label="Fill in realistic details"
            description="On (default): where your resume is thin, answers add plausible, consistent specifics so you sound like a real practitioner — always verify before saying them. Off: answers use only facts from your profile, stories, and JD."
            checked={settings.allowInventedDetails}
            onCheckedChange={(v) => update({ allowInventedDetails: v })}
            disabled={!hydrated}
          />
          <ToggleRow
            label="Stealth (hide from screen share)"
            description="Desktop app only. On (default): the overlay is excluded from screen capture / screen share and hidden from the taskbar — it stays visible on your screen. Toggle anytime with Ctrl/Cmd+Shift+S."
            checked={settings.stealth}
            onCheckedChange={(v) => {
              update({ stealth: v });
              void getElectronAPI()?.stealth.set(v);
            }}
            disabled={!hydrated}
          />
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Dark theme"
            description="Toggle between dark and light mode."
            checked={theme !== "light"}
            onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
            icon={theme !== "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          />
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete all locally stored profiles, stories, and sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={clearAll} disabled={clearing}>
            {clearing ? <Spinner /> : <Trash2 className="h-4 w-4" />} Delete all local data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({
  label,
  ok,
  optional,
}: {
  label: string;
  ok: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span>{label}</span>
      {ok ? (
        <span className="flex items-center gap-1.5 text-success">
          <CheckCircle2 className="h-4 w-4" /> Configured
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <XCircle className="h-4 w-4" /> {optional ? "Not set" : "Missing"}
        </span>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 font-mono text-sm">
        {value}
      </p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  icon,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
