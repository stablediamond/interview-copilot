"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Compass, Sparkles } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { SharedEventSession } from "@/components/shared-event-session";
import { SharedCandidateDetails, SharedApplicationDetails } from "@/components/shared-session-details";
import type { SharedSessionContext } from "@/lib/shared-event-session-types";
import { ChatGptSessionSplit } from "@/components/chatgpt-session-split";
import { SessionMaterialsDialog } from "@/components/session-materials-dialog";
import { useSettings } from "@/hooks/use-settings";
import { apiFetch } from "@/lib/client";
import { getElectronAPI } from "@/lib/electron";
import { buildInterviewBriefPrompt } from "@/lib/interview-prompt";
import { resolveInterviewPrompts } from "@/lib/interview-prompts";
import { displayResumeText } from "@/lib/resume-plain-text";

type SavedSessionMaterials = {
  candidateProfileId: string;
  jobProfileId: string;
  candidateLabel: string;
  jobLabel: string;
  jobRole: string;
  jobCompany: string;
  resumeText: string;
  jobDescription: string;
  basePrompts: string;
};

type CalendarSessionContext = SavedSessionMaterials & {
  privilege: string;
  sessionTitle: string;
  missingCandidate: boolean;
  missingJob: boolean;
};

export default function SessionPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-[240px] items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <SessionPageContent />
    </React.Suspense>
  );
}

function SessionPageContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() ?? "";
  const { settings, hydrated } = useSettings();

  const [candidateId, setCandidateId] = React.useState("");
  const [jobId, setJobId] = React.useState("");
  const [candidateLabel, setCandidateLabel] = React.useState("");
  const [jobLabel, setJobLabel] = React.useState("");
  const [jobRole, setJobRole] = React.useState("");
  const [jobCompany, setJobCompany] = React.useState("");
  const [resumeText, setResumeText] = React.useState("");
  const [jobDescription, setJobDescription] = React.useState("");
  const [basePrompts, setBasePrompts] = React.useState("");
  const [sessionTitle, setSessionTitle] = React.useState("");
  const [detectedQuestion, setDetectedQuestion] = React.useState("");
  const [briefBuilding, setBriefBuilding] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [shared, setShared] = React.useState<SharedSessionContext | null>(null);
  const [sharedError, setSharedError] = React.useState("");
  const [sharedRetry, setSharedRetry] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setShared(null); setSharedError("");
    if (!eventId) return;
    void apiFetch<SharedSessionContext>(`/api/calendar/shared-session?eventId=${encodeURIComponent(eventId)}`)
      .then(value => { if (!cancelled) setShared(value); })
      .catch(error => { if (!cancelled) setSharedError(error instanceof Error ? error.message : "Could not load shared session."); });
    return () => { cancelled = true; };
  }, [eventId, sharedRetry]);

  React.useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    const applyMaterials = (materials: SavedSessionMaterials) => {
      setCandidateId(materials.candidateProfileId);
      setJobId(materials.jobProfileId);
      setJobRole(materials.jobRole);
      setJobCompany(materials.jobCompany);
      setResumeText(displayResumeText(materials.resumeText));
      setJobDescription(materials.jobDescription);
      setBasePrompts(
        resolveInterviewPrompts(
          materials.basePrompts,
          settings.defaultInterviewPrompts,
        ),
      );
    };

    (async () => {
      try {
        if (eventId) {
          try {
            const ctx = await apiFetch<CalendarSessionContext>(
              `/api/calendar/session?eventId=${encodeURIComponent(eventId)}`,
            );
            if (cancelled) return;
            setCandidateLabel(ctx.candidateLabel);
            setJobLabel(ctx.jobLabel);
            setSessionTitle(ctx.sessionTitle);
            applyMaterials(ctx);
            return;
          } catch (err) {
            if (cancelled) return;
            const materials = await apiFetch<SavedSessionMaterials>(
              `/api/calendar/session/materials?eventId=${encodeURIComponent(eventId)}`,
            );
            if (cancelled) return;
            applyMaterials(materials);
            toast.error("Could not load calendar event data", {
              description:
                err instanceof Error
                  ? `${err.message} You can still edit resume, JD, and base prompts.`
                  : "You can still edit resume, JD, and base prompts.",
            });
            return;
          }
        }

        setCandidateLabel("");
        setJobLabel("");
        setSessionTitle("");
        const materials = await apiFetch<SavedSessionMaterials>(
          "/api/calendar/session/materials",
        );
        if (cancelled) return;
        applyMaterials(materials);
      } catch (err) {
        if (cancelled) return;
        toast.error("Could not load session data", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, hydrated]);

  const buildBrief = React.useCallback(async () => {
    setBriefBuilding(true);
    try {
      const prompt = buildInterviewBriefPrompt(
        basePrompts,
        resumeText,
        jobDescription,
        jobRole || null,
        jobCompany || null,
      );
      const api = getElectronAPI();
      if (!api?.chatgpt.submit) {
        toast.error("Open the desktop app to send this brief into ChatGPT.");
        return;
      }
      const result = await api.chatgpt.submit(prompt);
      if (!result.ok) {
        throw new Error(result.error || "Open a ChatGPT chat and try again.");
      }
      toast.success("Sent to ChatGPT", {
        description:
          "Base interview prompts, resume, and the job description are in the composer.",
      });
    } catch (err) {
      toast.error("Could not send the brief to ChatGPT", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBriefBuilding(false);
    }
  }, [basePrompts, jobCompany, jobDescription, jobRole, resumeText]);

  return (
    <div className="space-y-4">
      {eventId ? shared ? (
        <SharedEventSession key={eventId} event={shared.event} userId={shared.userId}
          canEditMeeting={shared.privilege === "manager"} calendarPath="/calendar"
          candidatePanel={shared.candidate && shared.application ? <SharedCandidateDetails context={shared} /> : undefined}
          applicationPanel={shared.candidate && shared.application ? <SharedApplicationDetails context={shared} /> : undefined}
          briefPanel={<PositioningBriefCard building={briefBuilding} canBuild={hydrated} onEdit={() => setEditOpen(true)} onBuild={() => void buildBrief()} />}
          gptPanel={editOpen ? null : <ChatGptSessionSplit question={detectedQuestion} onQuestionChange={setDetectedQuestion} />}
        />
      ) : <Card><CardContent className="space-y-3 p-4"><p role="status">{sharedError || "Loading shared event session…"}</p>{sharedError ? <Button onClick={() => setSharedRetry(value => value + 1)}>Retry</Button> : <Spinner />}</CardContent></Card> : (
        <>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Live session</h1>
        <p className="text-sm text-muted-foreground">
          Keep ChatGPT in view, then record a caption or type a question and
          send it with Answer.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="session-candidate">Candidate profile</Label>
            <Input
              id="session-candidate"
              value={candidateLabel || "None"}
              readOnly
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="session-job">Job profile</Label>
            <Input id="session-job" value={jobLabel || "None"} readOnly />
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
        building={briefBuilding}
        canBuild
        onEdit={() => setEditOpen(true)}
        onBuild={() => void buildBrief()}
      />

        </>
      )}

      {eventId && sharedError ? <>
        <PositioningBriefCard building={briefBuilding} canBuild={hydrated} onEdit={() => setEditOpen(true)} onBuild={() => void buildBrief()} />
        {editOpen ? null : <ChatGptSessionSplit question={detectedQuestion} onQuestionChange={setDetectedQuestion} />}
      </> : null}

      <SessionMaterialsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        candidateProfileId={candidateId}
        jobProfileId={jobId}
        candidateName={candidateLabel}
        jobRole={jobRole}
        jobCompany={jobCompany}
        resumeText={resumeText}
        jobDescription={jobDescription}
        basePrompts={basePrompts}
        defaultInterviewPrompts={settings.defaultInterviewPrompts}
        onSaved={(saved) => {
          setCandidateId(saved.candidateProfileId);
          setJobId(saved.jobProfileId);
          setResumeText(displayResumeText(saved.resumeText));
          setJobDescription(saved.jobDescription);
          setBasePrompts(
            resolveInterviewPrompts(
              saved.basePrompts,
              settings.defaultInterviewPrompts,
            ),
          );
          if (saved.jobRole) setJobRole(saved.jobRole);
          if (saved.jobCompany) setJobCompany(saved.jobCompany);
        }}
      />

      {eventId || editOpen ? null : (
        <ChatGptSessionSplit
          question={detectedQuestion}
          onQuestionChange={setDetectedQuestion}
        />
      )}
    </div>
  );
}

function PositioningBriefCard({
  building,
  canBuild,
  onEdit,
  onBuild,
}: {
  building: boolean;
  canBuild: boolean;
  onEdit: () => void;
  onBuild: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 flex-wrap">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4" /> Positioning brief
          </CardTitle>
          <CardDescription>
            Combine interview prompts from Settings with the JD and resume, then
            send them into ChatGPT.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onBuild}
            disabled={!canBuild || building}
          >
            {building ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            {building ? "Sending" : "Build brief"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {building ? (
          <p className="text-sm text-muted-foreground">
            Sending interview prompts, resume, and JD to ChatGPT…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Open Edit to review resume and JD. Interview prompts default from
            Settings — a linked application is optional — then build the brief
            into ChatGPT.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
