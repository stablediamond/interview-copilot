"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Trash2,
  Sparkles,
  AlertTriangle,
  Mail,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { FieldChips } from "@/components/field-list";
import { RichAnswer } from "@/components/rich-answer";
import { apiFetch } from "@/lib/client";
import { formatDate } from "@/lib/utils";
import {
  ANSWER_MODE_LABELS,
  INTERVIEW_STAGE_LABELS,
  QUESTION_TYPE_LABELS,
} from "@/lib/constants";
import type { SessionDetail, TurnDto } from "@/lib/types";
import type { PostInterviewReview } from "@/lib/schemas";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [session, setSession] = React.useState<SessionDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [review, setReview] = React.useState<PostInterviewReview | null>(null);
  const [reviewing, setReviewing] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const detail = await apiFetch<SessionDetail>(`/api/sessions/${id}`);
        setSession(detail);
      } catch (err) {
        setNotFound(true);
        toast.error("Could not load session", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const exportMarkdown = () => {
    if (!session) return;
    const md = buildMarkdown(session, review);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(session.title)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Exported as Markdown");
  };

  const deleteSession = async () => {
    if (!session) return;
    if (!window.confirm(`Delete "${session.title}" and all turns?`)) return;
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      toast.success("Session deleted");
      router.push("/history");
    } catch (err) {
      toast.error("Could not delete session", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const generateReview = async () => {
    if (!session) return;
    setReviewing(true);
    try {
      const result = await apiFetch<PostInterviewReview>(
        `/api/sessions/${session.id}/review`,
        { method: "POST" }
      );
      setReview(result);
      toast.success("Review generated");
    } catch (err) {
      toast.error("Could not generate review", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-40 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !session) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="font-medium">Session not found</p>
          <Button asChild variant="outline">
            <Link href="/history">
              <ArrowLeft className="h-4 w-4" /> Back to history
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/history">
              <ArrowLeft className="h-4 w-4" /> History
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{session.title}</h1>
          <p className="text-sm text-muted-foreground">
            {session.jobProfile
              ? `${session.jobProfile.roleTitle} @ ${session.jobProfile.company} · `
              : ""}
            {session.candidateProfile ? `${session.candidateProfile.name} · ` : ""}
            {formatDate(session.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportMarkdown}>
            <Download className="h-4 w-4" /> Export Markdown
          </Button>
          <Button variant="secondary" onClick={generateReview} disabled={reviewing}>
            {reviewing ? <Spinner /> : <Sparkles className="h-4 w-4" />} Generate review
          </Button>
          <Button variant="ghost" size="icon" onClick={deleteSession}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {review && <ReviewCard review={review} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Turns ({session.turns.length})</CardTitle>
          <CardDescription>Questions detected and answers generated.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {session.turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No turns were saved in this session.</p>
          ) : (
            session.turns.map((turn, i) => <TurnCard key={turn.id} turn={turn} index={i} />)
          )}
        </CardContent>
      </Card>

      {session.transcript.trim() && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-sm scrollbar-thin">
              {session.transcript}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TurnCard({ turn, index }: { turn: TurnDto; index: number }) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Q{index + 1}</span>
        {turn.interviewStage && turn.interviewStage !== "general" && (
          <Badge variant="outline" className="font-normal">
            {INTERVIEW_STAGE_LABELS[
              turn.interviewStage as keyof typeof INTERVIEW_STAGE_LABELS
            ] ?? turn.interviewStage}
          </Badge>
        )}
        <Badge variant="outline" className="font-normal">
          {QUESTION_TYPE_LABELS[turn.questionType as keyof typeof QUESTION_TYPE_LABELS] ??
            turn.questionType}
        </Badge>
        <Badge variant="secondary" className="font-normal">
          {ANSWER_MODE_LABELS[turn.answerMode as keyof typeof ANSWER_MODE_LABELS] ??
            turn.answerMode}
        </Badge>
        <ConfidenceBadge confidence={turn.confidence} />
      </div>
      <p className="font-medium">{turn.detectedQuestion}</p>
      <div className="mt-1 text-sm">
        <RichAnswer text={turn.generatedAnswer} />
      </div>

      {turn.keywords.length > 0 && (
        <div className="mt-3">
          <FieldChips label="Keywords" items={turn.keywords} />
        </div>
      )}
      {turn.riskNote && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{turn.riskNote}</span>
        </div>
      )}
      {turn.possibleFollowUp && (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium">Possible follow-up:</span> {turn.possibleFollowUp}
        </p>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: PostInterviewReview }) {
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-base">Post-interview review</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <ReviewList title="Questions asked" items={review.questions_asked} />
        <ReviewList title="Strongest answers" items={review.strongest_answers} variant="success" />
        <ReviewList title="Weak answers" items={review.weak_answers} variant="warning" />
        <ReviewList title="Missing prep areas" items={review.missing_prep_areas} variant="destructive" />
        {review.follow_up_email && (
          <div className="md:col-span-2">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Follow-up email draft
            </p>
            <pre className="whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-sm">
              {review.follow_up_email}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewList({
  title,
  items,
  variant = "secondary",
}: {
  title: string;
  items: string[];
  variant?: React.ComponentProps<typeof Badge>["variant"];
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant={variant} className="font-normal">
          {title}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">—</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session"
  );
}

function buildMarkdown(session: SessionDetail, review: PostInterviewReview | null): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push("");
  if (session.jobProfile) {
    lines.push(`**Role:** ${session.jobProfile.roleTitle} @ ${session.jobProfile.company}`);
  }
  if (session.candidateProfile) {
    lines.push(`**Candidate:** ${session.candidateProfile.name}`);
  }
  lines.push(`**Date:** ${formatDate(session.createdAt)}`);
  lines.push("");

  lines.push(`## Turns (${session.turns.length})`);
  session.turns.forEach((turn, i) => {
    lines.push("");
    lines.push(`### Q${i + 1}: ${turn.detectedQuestion}`);
    lines.push(
      `- Stage: ${turn.interviewStage} · Type: ${turn.questionType} · Mode: ${turn.answerMode} · Confidence: ${turn.confidence}`
    );
    lines.push("");
    lines.push(turn.generatedAnswer);
    if (turn.keywords.length) lines.push(`\n_Keywords: ${turn.keywords.join(", ")}_`);
    if (turn.riskNote) lines.push(`\n> Risk: ${turn.riskNote}`);
    if (turn.possibleFollowUp) lines.push(`\n_Possible follow-up: ${turn.possibleFollowUp}_`);
  });

  if (review) {
    lines.push("");
    lines.push("## Post-interview review");
    const section = (title: string, items: string[]) => {
      lines.push("");
      lines.push(`### ${title}`);
      if (items.length === 0) lines.push("- —");
      else items.forEach((i) => lines.push(`- ${i}`));
    };
    section("Questions asked", review.questions_asked);
    section("Strongest answers", review.strongest_answers);
    section("Weak answers", review.weak_answers);
    section("Missing prep areas", review.missing_prep_areas);
    if (review.follow_up_email) {
      lines.push("");
      lines.push("### Follow-up email draft");
      lines.push("");
      lines.push(review.follow_up_email);
    }
  }

  if (session.transcript.trim()) {
    lines.push("");
    lines.push("## Transcript");
    lines.push("");
    lines.push("```");
    lines.push(session.transcript);
    lines.push("```");
  }

  return lines.join("\n");
}
