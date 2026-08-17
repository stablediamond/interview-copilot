"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Upload, Sparkles, BookText, FlaskConical } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { FieldChips, FieldText } from "@/components/field-list";
import { apiFetch } from "@/lib/client";
import { SAMPLE_JD, SAMPLE_RESUME } from "@/lib/samples";
import type {
  CandidateProfileDto,
  CandidateStructured,
  JobProfileDto,
  JobStructured,
} from "@/lib/types";

export default function SetupPage() {
  const [resumeText, setResumeText] = React.useState("");
  const [jdText, setJdText] = React.useState("");

  const [candidate, setCandidate] = React.useState<{
    profile: CandidateProfileDto;
    structured: CandidateStructured;
  } | null>(null);
  const [job, setJob] = React.useState<{
    profile: JobProfileDto;
    structured: JobStructured;
  } | null>(null);

  const [analyzingResume, setAnalyzingResume] = React.useState(false);
  const [analyzingJd, setAnalyzingJd] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [generatingStories, setGeneratingStories] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadSample = () => {
    setResumeText(SAMPLE_RESUME);
    setJdText(SAMPLE_JD);
    toast.success("Sample resume and JD loaded", {
      description: "This is clearly-marked sample data for testing.",
    });
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { text } = await apiFetch<{ text: string }>("/api/upload-resume", {
        method: "POST",
        body: form,
      });
      setResumeText(text);
      toast.success("File parsed", { description: `Loaded ${file.name}` });
    } catch (err) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const analyzeResume = async () => {
    if (!resumeText.trim()) {
      toast.error("Paste or upload a resume first.");
      return;
    }
    setAnalyzingResume(true);
    try {
      const result = await apiFetch<{
        profile: CandidateProfileDto;
        structured: CandidateStructured;
      }>("/api/analyze-resume", {
        method: "POST",
        body: JSON.stringify({ rawResumeText: resumeText }),
      });
      setCandidate(result);
      toast.success("Resume analyzed", {
        description: `Saved profile for ${result.structured.name || "candidate"}.`,
      });
    } catch (err) {
      toast.error("Could not analyze resume", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAnalyzingResume(false);
    }
  };

  const analyzeJd = async () => {
    if (!jdText.trim()) {
      toast.error("Paste a job description first.");
      return;
    }
    setAnalyzingJd(true);
    try {
      const result = await apiFetch<{
        profile: JobProfileDto;
        structured: JobStructured;
      }>("/api/analyze-jd", {
        method: "POST",
        body: JSON.stringify({ rawJobDescription: jdText }),
      });
      setJob(result);
      toast.success("Job description analyzed", {
        description: `${result.structured.role_title || "Role"} at ${
          result.structured.company || "company"
        }.`,
      });
    } catch (err) {
      toast.error("Could not analyze job description", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAnalyzingJd(false);
    }
  };

  const generateStoryBank = async () => {
    if (!candidate) {
      toast.error("Analyze your resume first to build a story bank.");
      return;
    }
    setGeneratingStories(true);
    try {
      // Find which categories already exist so we only fill gaps.
      const existing = await apiFetch<Array<{ category: string }>>("/api/stories");
      const existingCategories = Array.from(new Set(existing.map((s) => s.category)));

      const { created } = await apiFetch<{ created: unknown[] }>(
        "/api/stories/generate",
        {
          method: "POST",
          body: JSON.stringify({
            candidateProfileId: candidate.profile.id,
            existingCategories,
          }),
        }
      );

      if (created.length === 0) {
        toast.info("Story bank already covers every category.");
      } else {
        toast.success(`Generated ${created.length} stories`, {
          description: "Open the Stories page to review and edit them.",
        });
      }
    } catch (err) {
      toast.error("Could not generate stories", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setGeneratingStories(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Setup</h1>
          <p className="text-sm text-muted-foreground">
            Add your resume and the job description, then extract structured profiles.
          </p>
        </div>
        <Button variant="outline" onClick={loadSample}>
          <FlaskConical className="h-4 w-4" /> Load sample data
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Resume */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Resume
            </CardTitle>
            <CardDescription>Paste your resume, or upload a .txt or .pdf file.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume text here…"
              className="min-h-[220px] scrollbar-thin"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,text/plain,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Spinner /> : <Upload className="h-4 w-4" />} Upload file
              </Button>
              <Button onClick={analyzeResume} disabled={analyzingResume}>
                {analyzingResume ? <Spinner /> : <Sparkles className="h-4 w-4" />} Analyze resume
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* JD */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Job description
            </CardTitle>
            <CardDescription>Paste the job description for the role you&apos;re targeting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the job description here…"
              className="min-h-[220px] scrollbar-thin"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={analyzeJd} disabled={analyzingJd}>
                {analyzingJd ? <Spinner /> : <Sparkles className="h-4 w-4" />} Analyze JD
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={generateStoryBank}
          disabled={generatingStories || !candidate}
        >
          {generatingStories ? <Spinner /> : <BookText className="h-4 w-4" />} Generate story bank
        </Button>
        {!candidate && (
          <span className="text-sm text-muted-foreground">
            Analyze your resume to enable story generation.
          </span>
        )}
      </div>

      {/* Extracted profiles */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Candidate profile</CardTitle>
            <CardDescription>Extracted from your resume.</CardDescription>
          </CardHeader>
          <CardContent>
            {candidate ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FieldText label="Name" value={candidate.structured.name} />
                  <FieldText label="Seniority" value={candidate.structured.seniority} />
                </div>
                <FieldChips label="Core stack" items={candidate.structured.core_stack} />
                <FieldChips label="Strong projects" items={candidate.structured.projects} />
                <FieldChips label="Metrics" items={candidate.structured.metrics} variant="success" />
                <FieldChips label="Leadership" items={candidate.structured.leadership} />
                <FieldChips label="Domains" items={candidate.structured.domains} variant="outline" />
                <FieldChips
                  label="Gaps / risky unsupported topics"
                  items={candidate.structured.weak_or_missing_evidence}
                  variant="warning"
                />
              </div>
            ) : (
              <EmptyHint text="Analyze a resume to see the extracted candidate profile." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job profile</CardTitle>
            <CardDescription>Extracted from the job description.</CardDescription>
          </CardHeader>
          <CardContent>
            {job ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FieldText label="Role" value={job.structured.role_title} />
                  <FieldText label="Company" value={job.structured.company} />
                </div>
                <FieldChips label="Must-have skills" items={job.structured.must_have_skills} />
                <FieldChips
                  label="Preferred skills"
                  items={job.structured.preferred_skills}
                  variant="outline"
                />
                <FieldText label="Domain" value={job.structured.domain} />
                <FieldChips
                  label="Likely interview focus"
                  items={job.structured.likely_interview_focus}
                />
                <FieldChips label="Likely questions" items={job.structured.likely_questions} />
              </div>
            ) : (
              <EmptyHint text="Analyze a job description to see the extracted job profile." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex min-h-[140px] items-center justify-center rounded-md border border-dashed border-border text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
