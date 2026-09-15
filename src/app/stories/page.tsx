"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Sparkles, Wand2, BookText } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StoryDialog } from "@/components/story-dialog";
import { apiFetch } from "@/lib/client";
import { storyCategoryLabel } from "@/lib/constants";
import type {
  CandidateProfileDto,
  JobProfileDto,
  ProfilesResponse,
  StoryDto,
} from "@/lib/types";

export default function StoriesPage() {
  const [stories, setStories] = React.useState<StoryDto[]>([]);
  const [candidates, setCandidates] = React.useState<CandidateProfileDto[]>([]);
  const [selectedCandidate, setSelectedCandidate] = React.useState<string>("");
  const [jobs, setJobs] = React.useState<JobProfileDto[]>([]);
  const [selectedJob, setSelectedJob] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [improvingId, setImprovingId] = React.useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StoryDto | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [storyList, profiles] = await Promise.all([
        apiFetch<StoryDto[]>("/api/stories"),
        apiFetch<ProfilesResponse>("/api/profiles"),
      ]);
      setStories(storyList);
      setCandidates(profiles.candidates);
      setSelectedCandidate((prev) => prev || profiles.candidates[0]?.id || "");
      setJobs(profiles.jobs);
      setSelectedJob((prev) => prev || profiles.jobs[0]?.id || "");
    } catch (err) {
      toast.error("Could not load stories", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const existingCategories = React.useMemo(
    () => Array.from(new Set(stories.map((s) => s.category))),
    [stories]
  );

  const handleSaved = (saved: StoryDto) => {
    setStories((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
  };

  const handleDelete = async (story: StoryDto) => {
    if (!window.confirm(`Delete "${story.title}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/stories/${story.id}`, { method: "DELETE" });
      setStories((prev) => prev.filter((s) => s.id !== story.id));
      toast.success("Story deleted");
    } catch (err) {
      toast.error("Could not delete story", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const handleImprove = async (story: StoryDto) => {
    setImprovingId(story.id);
    try {
      const improved = await apiFetch<StoryDto>("/api/stories/improve", {
        method: "POST",
        body: JSON.stringify({ storyId: story.id }),
      });
      handleSaved(improved);
      toast.success("Story tone improved");
    } catch (err) {
      toast.error("Could not improve story", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setImprovingId(null);
    }
  };

  const handleGenerate = async () => {
    if (!selectedCandidate) {
      toast.error("Select a candidate profile first.");
      return;
    }
    setGenerating(true);
    try {
      const { created } = await apiFetch<{ created: StoryDto[] }>(
        "/api/stories/generate",
        {
          method: "POST",
          body: JSON.stringify({
            candidateProfileId: selectedCandidate,
            jobProfileId: selectedJob || undefined,
            existingCategories,
          }),
        }
      );
      if (created.length === 0) {
        toast.info("Story bank already covers every category.");
      } else {
        setStories((prev) => [...created, ...prev]);
        toast.success(`Generated ${created.length} missing stories`);
      }
    } catch (err) {
      toast.error("Could not generate stories", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setGenerating(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (story: StoryDto) => {
    setEditing(story);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Story bank</h1>
          <p className="text-sm text-muted-foreground">
            Reusable answers with short, STAR, and technical versions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {candidates.length > 0 && (
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select candidate" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || "Unnamed"} — {c.targetTitle || "candidate"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {jobs.length > 0 && (
            <Select value={selectedJob} onValueChange={setSelectedJob}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Target role (optional)" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.roleTitle || "Role"}
                    {j.company ? ` — ${j.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="secondary"
            onClick={handleGenerate}
            disabled={generating || candidates.length === 0}
          >
            {generating ? <Spinner /> : <Sparkles className="h-4 w-4" />} Generate missing
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New story
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingGrid />
      ) : stories.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              improving={improvingId === story.id}
              onEdit={() => openEdit(story)}
              onDelete={() => handleDelete(story)}
              onImprove={() => handleImprove(story)}
            />
          ))}
        </div>
      )}

      <StoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        story={editing}
        onSaved={handleSaved}
      />
    </div>
  );
}

function StoryCard({
  story,
  improving,
  onEdit,
  onDelete,
  onImprove,
}: {
  story: StoryDto;
  improving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onImprove: () => void;
}) {
  const categoryLabel = storyCategoryLabel(story.category);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{story.title}</CardTitle>
            <Badge variant="outline" className="mt-1 font-normal">
              {categoryLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onImprove} disabled={improving} title="Improve tone">
              {improving ? <Spinner /> : <Wand2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="short">
          <TabsList>
            <TabsTrigger value="short">Short</TabsTrigger>
            <TabsTrigger value="star">STAR</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
          </TabsList>
          <TabsContent value="short">
            <p className="text-sm leading-relaxed">{story.shortVersion || "—"}</p>
          </TabsContent>
          <TabsContent value="star">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{story.starVersion || "—"}</p>
          </TabsContent>
          <TabsContent value="technical">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{story.technicalVersion || "—"}</p>
          </TabsContent>
        </Tabs>
        {story.keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {story.keywords.map((k, i) => (
              <Badge key={`${k}-${i}`} variant="secondary" className="font-normal">
                {k}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <BookText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">No stories yet</p>
          <p className="text-sm text-muted-foreground">
            Create one manually, or generate a bank from a saved candidate profile.
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" /> New story
        </Button>
        <p className="text-xs text-muted-foreground">
          Categories are tailored to your resume &amp; role
        </p>
      </CardContent>
    </Card>
  );
}
