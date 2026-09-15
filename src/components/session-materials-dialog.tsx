"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/client";
import { resolveInterviewPrompts } from "@/lib/interview-prompts";
import { displayResumeText } from "@/lib/resume-plain-text";

export type SessionMaterialsFields = {
  resumeText: string;
  jobDescription: string;
  basePrompts: string;
};

type SavedMaterials = SessionMaterialsFields & {
  candidateProfileId: string;
  jobProfileId: string;
  candidateLabel: string;
  jobLabel: string;
  jobRole: string;
  jobCompany: string;
};

export function SessionMaterialsDialog({
  open,
  onOpenChange,
  eventId,
  candidateProfileId,
  jobProfileId,
  candidateName,
  jobRole,
  jobCompany,
  resumeText,
  jobDescription,
  basePrompts,
  defaultInterviewPrompts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  candidateProfileId: string;
  jobProfileId: string;
  candidateName: string;
  jobRole: string;
  jobCompany: string;
  resumeText: string;
  jobDescription: string;
  basePrompts: string;
  defaultInterviewPrompts: string;
  onSaved: (saved: SavedMaterials) => void;
}) {
  const [form, setForm] = React.useState<SessionMaterialsFields>({
    resumeText: "",
    jobDescription: "",
    basePrompts: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [loadingResume, setLoadingResume] = React.useState(false);
  const onSavedRef = React.useRef(onSaved);
  const editedRef = React.useRef(false);
  onSavedRef.current = onSaved;

  React.useEffect(() => {
    if (!open) {
      editedRef.current = false;
      return;
    }
    if (editedRef.current) return;
    setForm({
      resumeText: displayResumeText(resumeText),
      jobDescription,
      basePrompts: resolveInterviewPrompts(
        basePrompts,
        defaultInterviewPrompts,
      ),
    });
  }, [open, resumeText, jobDescription, basePrompts, defaultInterviewPrompts]);

  React.useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    setLoadingResume(true);
    (async () => {
      try {
        const ctx = await apiFetch<SavedMaterials>(
          `/api/calendar/session?eventId=${encodeURIComponent(eventId)}`,
        );
        if (cancelled || editedRef.current) return;
        const next = {
          resumeText: displayResumeText(ctx.resumeText),
          jobDescription: ctx.jobDescription,
          basePrompts: resolveInterviewPrompts(
            ctx.basePrompts,
            defaultInterviewPrompts,
          ),
        };
        setForm(next);
        onSavedRef.current({
          ...ctx,
          resumeText: next.resumeText,
          basePrompts: next.basePrompts,
        });
      } catch {
        // Keep the values already copied from props.
      } finally {
        if (!cancelled) setLoadingResume(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<SavedMaterials>(
        "/api/calendar/session/materials",
        {
          method: "POST",
          body: JSON.stringify({
            eventId: eventId || undefined,
            candidateProfileId: candidateProfileId || undefined,
            jobProfileId: jobProfileId || undefined,
            candidateName,
            jobRole,
            jobCompany,
            resumeText: form.resumeText,
            jobDescription: form.jobDescription,
            basePrompts: form.basePrompts,
          }),
        },
      );
      onSaved({
        ...saved,
        resumeText: displayResumeText(saved.resumeText),
      });
      toast.success("Session materials saved");
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save session materials", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit session materials</DialogTitle>
          <DialogDescription>
            Resume is the linked application&apos;s resume JSON as readable
            text — not the raw JSON. Interview prompts default from Settings,
            not the Job Track resume-writer prompt. You can still tweak them
            for this session.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-resume">
              Resume
              {loadingResume ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Loading…
                </span>
              ) : null}
            </Label>
            <Textarea
              id="session-resume"
              value={form.resumeText}
              onChange={(e) => {
                editedRef.current = true;
                setForm((current) => ({
                  ...current,
                  resumeText: e.target.value,
                }));
              }}
              placeholder={
                loadingResume
                  ? "Loading the linked application resume…"
                  : eventId
                    ? "Plain-text resume from the linked application"
                    : "Paste the resume as plain text"
              }
              className="min-h-[280px] whitespace-pre-wrap bg-muted/30 text-sm leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-jd">JD</Label>
            <Textarea
              id="session-jd"
              value={form.jobDescription}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  jobDescription: e.target.value,
                }))
              }
              placeholder="Job description"
              className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-prompts">Interview prompts</Label>
            <Textarea
              id="session-prompts"
              value={form.basePrompts}
              onChange={(e) => {
                editedRef.current = true;
                setForm((current) => ({
                  ...current,
                  basePrompts: e.target.value,
                }));
              }}
              placeholder="Default interview prompts from Settings"
              className="min-h-[140px] whitespace-pre-wrap text-sm leading-relaxed"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
