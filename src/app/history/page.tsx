"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { History, Trash2, ArrowRight, MessagesSquare } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/client";
import { formatDate } from "@/lib/utils";
import type { SessionListItem } from "@/lib/types";

export default function HistoryPage() {
  const [sessions, setSessions] = React.useState<SessionListItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<SessionListItem[]>("/api/sessions");
      setSessions(list);
    } catch (err) {
      toast.error("Could not load sessions", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (session: SessionListItem) => {
    if (!window.confirm(`Delete session "${session.title}" and all its turns?`)) return;
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      toast.success("Session deleted");
    } catch (err) {
      toast.error("Could not delete session", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">
          Past sessions, exports, and post-interview reviews.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <History className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">No sessions yet</p>
              <p className="text-sm text-muted-foreground">
                Saved turns from a live session will appear here.
              </p>
            </div>
            <Button asChild>
              <Link href="/session">Start a session</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Card key={session.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/history/${session.id}`}
                    className="font-medium hover:underline"
                  >
                    {session.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {session.jobRole && (
                      <span>
                        {session.jobRole}
                        {session.jobCompany ? ` @ ${session.jobCompany}` : ""}
                      </span>
                    )}
                    {session.candidateName && <span>· {session.candidateName}</span>}
                    <span>· {formatDate(session.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <MessagesSquare className="h-3 w-3" /> {session.turnCount} turns
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(session)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/history/${session.id}`}>
                      Open <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
