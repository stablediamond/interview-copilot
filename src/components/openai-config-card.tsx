"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  KeyRound,
  RefreshCw,
  Save,
  Sparkles,
  Eye,
  EyeOff,
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
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/client";
import { isReasoningModelId } from "@/lib/models";

type ReasoningEffort = "fast" | "balanced" | "thorough";

interface SettingsStatus {
  hasKey: boolean;
  keySource: "settings" | "env" | "none";
  keyMasked: string;
  strongModel: string;
  fastModel: string;
  transcriptionModel: string;
  reasoningEffort: ReasoningEffort;
}

const REASONING_EFFORT_OPTIONS: {
  value: ReasoningEffort;
  label: string;
  hint: string;
}[] = [
  { value: "fast", label: "Fast", hint: "Lowest latency + cost (recommended for live answers)" },
  { value: "balanced", label: "Balanced", hint: "Medium effort — more thorough, a bit slower" },
  { value: "thorough", label: "Thorough", hint: "High effort — best quality, slowest + priciest" },
];

interface ModelRecommendation {
  chatModels: string[];
  transcriptionModels: string[];
  recommendedStrong: string | null;
  recommendedFast: string | null;
  recommendedTranscription: string | null;
}

export function OpenAiConfigCard({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [status, setStatus] = React.useState<SettingsStatus | null>(null);
  const [keyInput, setKeyInput] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [models, setModels] = React.useState<ModelRecommendation | null>(null);

  const [savingKey, setSavingKey] = React.useState(false);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [savingModels, setSavingModels] = React.useState(false);

  const [strong, setStrong] = React.useState("");
  const [fast, setFast] = React.useState("");
  const [transcription, setTranscription] = React.useState("");
  const [effort, setEffort] = React.useState<ReasoningEffort>("fast");
  const [savingEffort, setSavingEffort] = React.useState(false);

  const applyStatus = React.useCallback((s: SettingsStatus) => {
    setStatus(s);
    setStrong(s.strongModel);
    setFast(s.fastModel);
    setTranscription(s.transcriptionModel);
    setEffort(s.reasoningEffort);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const s = await apiFetch<SettingsStatus>("/api/settings");
      applyStatus(s);
    } catch {
      // Settings status is best-effort; ignore load errors here.
    }
  }, [applyStatus]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadModels = React.useCallback(
    async (keyOverride?: string) => {
      setLoadingModels(true);
      try {
        const result = await apiFetch<ModelRecommendation>("/api/models", {
          method: "POST",
          body: JSON.stringify(
            keyOverride ? { openaiApiKey: keyOverride } : {}
          ),
        });
        setModels(result);
        // If current selection isn't in the list, fall back to recommended.
        setStrong((prev) =>
          prev && result.chatModels.includes(prev)
            ? prev
            : result.recommendedStrong ?? prev
        );
        setFast((prev) =>
          prev && result.chatModels.includes(prev)
            ? prev
            : result.recommendedFast ?? prev
        );
        setTranscription((prev) =>
          prev && result.transcriptionModels.includes(prev)
            ? prev
            : result.recommendedTranscription ?? prev
        );
        toast.success(`Loaded ${result.chatModels.length} chat models`);
      } catch (err) {
        toast.error("Could not load models", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setLoadingModels(false);
      }
    },
    []
  );

  const saveKey = async () => {
    if (!keyInput.trim()) {
      toast.error("Enter an API key first.");
      return;
    }
    setSavingKey(true);
    try {
      const s = await apiFetch<SettingsStatus>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ openaiApiKey: keyInput.trim() }),
      });
      applyStatus(s);
      const savedKey = keyInput.trim();
      setKeyInput("");
      toast.success("API key saved");
      onChanged?.();
      await loadModels(savedKey);
    } catch (err) {
      toast.error("Could not save key", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async () => {
    setSavingKey(true);
    try {
      const s = await apiFetch<SettingsStatus>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ openaiApiKey: null }),
      });
      applyStatus(s);
      toast.success("Saved key cleared", {
        description: "Falling back to the OPENAI_API_KEY environment variable, if set.",
      });
      onChanged?.();
    } catch (err) {
      toast.error("Could not clear key", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingKey(false);
    }
  };

  const saveModels = async () => {
    setSavingModels(true);
    try {
      const s = await apiFetch<SettingsStatus>("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          strongModel: strong || null,
          fastModel: fast || null,
          transcriptionModel: transcription || null,
        }),
      });
      applyStatus(s);
      toast.success("Models saved");
      onChanged?.();
    } catch (err) {
      toast.error("Could not save models", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingModels(false);
    }
  };

  const saveEffort = async (value: ReasoningEffort) => {
    const prev = effort;
    setEffort(value); // optimistic
    setSavingEffort(true);
    try {
      const s = await apiFetch<SettingsStatus>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ reasoningEffort: value }),
      });
      applyStatus(s);
      toast.success("Reasoning effort saved");
      onChanged?.();
    } catch (err) {
      setEffort(prev); // revert on failure
      toast.error("Could not save reasoning effort", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSavingEffort(false);
    }
  };

  const useRecommended = () => {
    if (!models) return;
    if (models.recommendedStrong) setStrong(models.recommendedStrong);
    if (models.recommendedFast) setFast(models.recommendedFast);
    if (models.recommendedTranscription)
      setTranscription(models.recommendedTranscription);
    toast.info("Recommended models selected", {
      description: "Click Save models to apply.",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> OpenAI key &amp; models
        </CardTitle>
        <CardDescription>
          Save your key here (stored locally in your database) — no need to edit the{" "}
          <code>.env</code> file. The key is never shown in full or sent to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Key status */}
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
          <span>API key</span>
          {status?.hasKey ? (
            <span className="flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" />
              {status.keyMasked}
              <Badge variant="secondary" className="font-normal">
                {status.keySource === "settings" ? "saved here" : "from .env"}
              </Badge>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <XCircle className="h-4 w-4" /> Not set
            </span>
          )}
        </div>

        {/* Key input */}
        <div className="space-y-1.5">
          <Label htmlFor="openai-key">
            {status?.hasKey ? "Replace API key" : "Add API key"}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="openai-key"
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? "Hide key" : "Show key"}
                tabIndex={0}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={saveKey} disabled={savingKey}>
              {savingKey ? <Spinner /> : <Save className="h-4 w-4" />} Save key
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadModels(keyInput.trim() || undefined)}
              disabled={loadingModels || (!status?.hasKey && !keyInput.trim())}
            >
              {loadingModels ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Test &amp; load
              models
            </Button>
            {status?.keySource === "settings" && (
              <Button variant="ghost" size="sm" onClick={clearKey} disabled={savingKey}>
                Clear saved key
              </Button>
            )}
          </div>
        </div>

        {/* Model selection */}
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Models</p>
            {models && (
              <Button variant="ghost" size="sm" onClick={useRecommended}>
                <Sparkles className="h-4 w-4" /> Use recommended
              </Button>
            )}
          </div>

          {!models ? (
            <p className="text-xs text-muted-foreground">
              Save a key, then “Test &amp; load models” to pick the best models your key can
              access. Analysis: <code>{status?.strongModel ?? "—"}</code> · Live answer:{" "}
              <code>{status?.fastModel ?? "—"}</code>.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <ModelSelect
                label="Analysis model (resume, JD, stories)"
                value={strong}
                onChange={setStrong}
                options={models.chatModels}
                recommended={models.recommendedStrong}
              />
              <ModelSelect
                label="Live answer model"
                value={fast}
                onChange={setFast}
                options={models.chatModels}
                recommended={models.recommendedFast}
              />
              <ModelSelect
                label="Transcription model"
                value={transcription}
                onChange={setTranscription}
                options={models.transcriptionModels}
                recommended={models.recommendedTranscription}
              />
            </div>
          )}

          {models && isReasoningModelId(fast) && (
            <p className="text-xs text-warning">
              Heads up: <code>{fast}</code> is a reasoning model. It thinks before
              the first word appears, so live answers will be noticeably slower to
              start. For the live answer slot, prefer a fast non-reasoning model
              (e.g. a <code>-mini</code> or <code>-chat</code> model).
            </p>
          )}

          {models && (
            <Button onClick={saveModels} disabled={savingModels}>
              {savingModels ? <Spinner /> : <Save className="h-4 w-4" />} Save models
            </Button>
          )}
        </div>

        {/* Reasoning effort — only affects reasoning models (gpt-5 family, o-series) */}
        <div className="space-y-1.5 border-t border-border pt-4">
          <Label className="text-sm font-medium">Reasoning effort</Label>
          <Select
            value={effort}
            onValueChange={(v) => void saveEffort(v as ReasoningEffort)}
            disabled={savingEffort}
          >
            <SelectTrigger className="sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REASONING_EFFORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {REASONING_EFFORT_OPTIONS.find((o) => o.value === effort)?.hint}. Tunes{" "}
            <strong>live answers</strong>; analysis tasks (resume, JD, stories, brief)
            automatically think one step harder. Only applies to reasoning models
            (gpt-5 family, o-series); other models ignore it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
  recommended,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  recommended: string | null;
}) {
  // Make sure the current value is selectable even if not in the fetched list.
  const list = React.useMemo(() => {
    const set = new Set(options);
    if (value) set.add(value);
    return Array.from(set);
  }, [options, value]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {list.length === 0 && (
            <SelectItem value="none" disabled>
              No models available
            </SelectItem>
          )}
          {list.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
              {m === recommended ? "  ★ recommended" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
