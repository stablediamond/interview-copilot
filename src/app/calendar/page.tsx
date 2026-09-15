"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { InterviewerWeekView } from "@/components/interviewer-week-view";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/client";
import { isJobTrackConfigured } from "@/lib/job-track";
import type { InterviewerCalendarPayload } from "@/lib/calendar-types";

const COPY = {
  interviewer: {
    description:
      "Interview events assigned to you in Job Track. Open an event to start a live session with that candidate and application.",
  },
  manager: {
    description:
      "Imported interview events for your team in Job Track. Open an event to start a live session with that candidate and application.",
  },
} as const;

export default function CalendarPage() {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: InterviewerCalendarPayload }
  >({ kind: "loading" });

  React.useEffect(() => {
    if (!isJobTrackConfigured()) {
      setState({
        kind: "error",
        message:
          "Job Track sign-in is off, so the calendar cannot load.",
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<InterviewerCalendarPayload>("/api/calendar");
        if (!cancelled) setState({ kind: "ready", data });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Could not load calendar.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          {state.kind === "ready"
            ? COPY[state.data.mode].description
            : "Interview events from Job Track. Managers see their team calendar; interviewers see events assigned to them."}
        </p>
      </div>

      {state.kind === "loading" ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <Spinner />
        </div>
      ) : state.kind === "error" ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
              <CalendarDays className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Calendar unavailable</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {state.message}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <InterviewerWeekView events={state.data.events} />
      )}
    </div>
  );
}
