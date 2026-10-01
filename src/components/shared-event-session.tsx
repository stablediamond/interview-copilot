"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionEvent, SessionMessage, SessionSnapshot } from "@/lib/shared-event-session-types";
import { getElectronAPI, type ChatgptAnswerUpdate } from "@/lib/electron";
import { apiFetch } from "@/lib/client";
import { getValidAccessToken } from "@/lib/job-track-auth";
import { readSessionStream } from "@/lib/session-stream";
const btnPrimary = "inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
const btnSecondary = "inline-flex items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
// Used for answer posts that happen before the session connection id exists.
const ANSWER_CONNECTION = "answer-stream";
const cardClass = "rounded-lg border border-border bg-card text-card-foreground";
const inputClass = "rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground";

type LinkField = "meeting" | "support";
function MeetingLink({ label, value, version, save, readOnly = false }: { label: string; value: string; version: number; readOnly?: boolean; save: (value: string, version: number) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const baseVersion = useRef(version);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!editing) { setDraft(value); baseVersion.current = version; } }, [value, version, editing]);
  async function commit() {
    if (readOnly) return;
    if (busy.current || draft === value) { if (draft === value) setEditing(false); return; }
    busy.current = true; setSaving(true); setNotice("");
    try { await save(draft, baseVersion.current); setEditing(false); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save."); }
    finally { busy.current = false; setSaving(false); }
  }
  return <div className="space-y-2">
    <label className="block text-sm font-medium">{label}
      <span className="relative mt-1 block">
        <input className={`${inputClass} w-full pr-11`} type="text" value={draft} readOnly={readOnly} disabled={saving}
          placeholder="https://…" onFocus={() => { if (readOnly) return; if (!editing) baseVersion.current = version; setEditing(true); }}
          onChange={e => { setEditing(true); setDraft(e.target.value); }} onBlur={() => void commit()}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void commit(); } }} />
        <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-40" disabled={!draft} aria-label={`Copy ${label.toLowerCase()}`} title="Copy link" onClick={async () => {
          try { await navigator.clipboard.writeText(draft); setNotice("Copied."); } catch { setNotice("Copy failed. Select and copy the text manually."); }
        }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg></button>
      </span>
    </label>
    {editing && version !== baseVersion.current ? <button type="button" className={btnSecondary} onClick={() => { setEditing(false); setNotice(""); }}>Use latest value</button> : null}
    <p className="text-xs text-slate-500" role="status">{saving ? "Saving…" : notice || (readOnly ? "Only managers can edit this link." : "Saves when you leave the field or press Enter.")}</p>
  </div>;
}

export function SharedEventSession({ event, userId, calendarPath, canEditMeeting, candidatePanel, applicationPanel, briefPanel, gptPanel }: { event: SessionEvent; userId: string; calendarPath: string; canEditMeeting: boolean; candidatePanel?: React.ReactNode; applicationPanel?: React.ReactNode; briefPanel?: React.ReactNode; gptPanel?: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [tab, setTab] = useState<"chat" | "copilot" | "candidate" | "application" | "gpt">("gpt");
  const messageKind = tab === "copilot" ? "copilot" : "chat";
  const showMessages = tab === "chat" || tab === "copilot";
  const [drafts, setDrafts] = useState({ chat: "", copilot: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const connection = useRef("");
  const cursor = useRef(0);
  const changeCursor = useRef(0);
  const [streamStatus, setStreamStatus] = useState("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingMessage = useRef<{ id: string; kind: string; body: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const endpoint = `/api/calendar/shared-session?eventId=${encodeURIComponent(event.id)}`;
  // True while the Server-Sent Events stream is delivering updates; polling is
  // only the fallback for when it is unavailable.
  const streamLive = useRef(false);
  const [live, setLive] = useState(false);
  // Snapshots from POST responses and from the stream merge identically: by
  // sequence, newest revision wins, so duplicates and reordering are harmless.
  const applySnapshot = useCallback((next: SessionSnapshot) => {
    changeCursor.current = Math.max(changeCursor.current, next.changeCursor ?? 0);
    setSnapshot(next);
    setMessages(previous => {
      const byId = new Map(previous.map(m => [m.sequence, m]));
      next.messages.forEach(m => { if ((byId.get(m.sequence)?.revision ?? -1) <= (m.revision ?? 0)) byId.set(m.sequence, m); });
      return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
    });
    cursor.current = Math.max(cursor.current, next.messageCursor ?? cursor.current);
    setConnected(true);
    setConnectionError("");
  }, []);
  const request = useCallback((payload: Record<string, unknown>): Promise<void> => {
    const task = queue.current.catch(() => {}).then(async () => {
      const next = await apiFetch<SessionSnapshot>(endpoint, { method: "POST",
        body: JSON.stringify({ ...payload, connectionId: connection.current, after: cursor.current, afterChange: changeCursor.current }), signal: AbortSignal.timeout(20_000) });
      applySnapshot(next);
    });
    queue.current = task;
    return task;
  }, [endpoint, applySnapshot]);
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.chatgpt.onAnswer) return;
    const pending = new Map<string, ChatgptAnswerUpdate>();
    const revisions = new Map<string, number>();
    let stopped = false;
    let sending = false;
    // Each delta is posted as soon as it arrives. Updates that arrive while a
    // post is in flight coalesce into the newest revision (the answer text is
    // cumulative), so the final "done" update can never be skipped.
    async function pump() {
      if (sending || stopped) return;
      sending = true;
      try {
        while (!stopped) {
          const update = pending.values().next().value;
          if (!update) break;
          try {
            await apiFetch(endpoint, { method: "POST", signal: AbortSignal.timeout(20_000), body: JSON.stringify({
              op: "answer", minimal: true, clientId: update.streamId, body: update.text, revision: update.revision, done: update.done,
              connectionId: connection.current || ANSWER_CONNECTION, after: 0 }) });
            if (pending.get(update.streamId)?.revision === update.revision) pending.delete(update.streamId);
            setStreamStatus(update.error || (update.done ? "GPT answer shared." : "Sharing GPT answer…"));
          } catch (error) {
            setStreamStatus(`Sharing interrupted; retrying. ${error instanceof Error ? error.message : ""}`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } finally { sending = false; }
    }
    const receive = (update: ChatgptAnswerUpdate) => {
      if (stopped || update.eventId !== event.id || update.revision <= (revisions.get(update.streamId) ?? 0)) return;
      revisions.set(update.streamId, update.revision);
      pending.set(update.streamId, update);
      setStreamStatus(update.error || "Sharing GPT answer…");
      void pump();
    };
    // Subscribe first so a newer live update cannot be lost while replay loads.
    const unsubscribe = api.chatgpt.onAnswer(receive);
    if (api.chatgpt.getAnswers) {
      void api.chatgpt.getAnswers(event.id).then(updates => updates.forEach(receive)).catch(error => {
        if (!stopped && !revisions.size) setStreamStatus(`Could not restore the GPT answer. ${error instanceof Error ? error.message : ""}`);
      });
    }
    // Updates may already be waiting (replayed after a reload).
    void pump();
    return () => { stopped = true; unsubscribe(); };
  }, [event.id, endpoint]);
  useEffect(() => {
    connection.current = crypto.randomUUID();
    const connectionId = connection.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastSync = 0;
    // Polling is the fallback: fast while the live stream is down, and only a
    // slow safety-net sync (links, presence) while the stream is delivering.
    async function sync() {
      if (!streamLive.current || Date.now() - lastSync >= 10_000) {
        lastSync = Date.now();
        try { await request({ op: "sync" }); }
        catch (error) { if (!streamLive.current) { setConnected(false); setConnectionError(error instanceof Error ? error.message : "Connection failed."); } }
      }
      if (!stopped) timer = setTimeout(sync, 150);
    }
    void sync();
    const leave = () => { void apiFetch(endpoint, { method: "POST", keepalive: true, body: JSON.stringify({ op: "leave", connectionId, after: 0 }) }).catch(() => {}); };
    window.addEventListener("pagehide", leave);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("pagehide", leave); void queue.current.finally(leave).catch(() => {}); };
  }, [endpoint, request]);
  // Live updates: Server-Sent Events from Job Track (through the local proxy).
  // Reconnects with the newest cursors and backs off while unavailable; the
  // polling effect above covers any gap.
  useEffect(() => {
    const streamUrl = `/api/calendar/shared-session/stream?eventId=${encodeURIComponent(event.id)}`;
    const abort = new AbortController();
    let backoff = 500;
    const markLive = (value: boolean) => { streamLive.current = value; setLive(value); };
    void (async () => {
      while (!abort.signal.aborted) {
        const started = Date.now();
        try {
          const token = await getValidAccessToken();
          const params = new URLSearchParams({ connectionId: connection.current || ANSWER_CONNECTION, after: String(cursor.current), afterChange: String(changeCursor.current) });
          await readSessionStream<SessionSnapshot>({
            url: `${streamUrl}&${params}`, token, signal: abort.signal,
            onOpen: () => markLive(true),
            onSnapshot: applySnapshot,
          });
          if (Date.now() - started > 3000) backoff = 500;
        } catch {
          if (abort.signal.aborted) break;
          backoff = Math.min(backoff * 2, 10_000);
        }
        markLive(false);
        if (!abort.signal.aborted) await new Promise(resolve => setTimeout(resolve, backoff));
      }
    })();
    return () => { abort.abort(); streamLive.current = false; };
  }, [event.id, applySnapshot]);
  useEffect(() => { if (tab === "chat" && follow.current) bottom.current?.scrollIntoView({ block: "nearest" }); }, [messages, tab]);
  async function send() {
    const body = drafts[messageKind].trim();
    if (!body || sending) return;
    setSending(true); setError("");
    if (pendingMessage.current?.body !== body || pendingMessage.current?.kind !== messageKind) pendingMessage.current = { id: crypto.randomUUID(), kind: messageKind, body };
    const pending = pendingMessage.current;
    try {
      await request({ op: "message", kind: messageKind, body, clientId: pending.id });
      setDrafts(previous => ({ ...previous, [messageKind]: "" })); pendingMessage.current = null;
      follow.current = true;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send. Retry to send the same message safely."); }
    finally { setSending(false); }
  }
  const saveLink = (field: LinkField) => (value: string, version: number) => request({ op: "link", field, value, version });
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-semibold">Session</h1><Link className={btnSecondary} href={calendarPath}>Back to calendar</Link></div>
    <p role="status" className="text-sm text-slate-500">{connected ? (live ? "Connected · live updates" : "Connected · polling for updates") : `Connecting / reconnecting… ${connectionError} Presence may be out of date.`}</p>
    {streamStatus ? <p role="status" className="text-sm text-muted-foreground">{streamStatus}</p> : null}
    <div className="grid min-w-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={`${cardClass} flex min-w-0 flex-col gap-6 p-4`}>
        <section><h2 className="mb-3 font-semibold">Participants</h2><ul className="space-y-2">{snapshot?.participants.map(p => <li key={p.user_id} className="flex items-start gap-2 text-sm"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${connected && p.online ? "bg-emerald-500" : "bg-slate-400"}`} /><span>{p.name}{p.user_id === userId ? " (you)" : ""}<span className="block text-xs text-slate-500">{p.privilege} · {!connected ? "Unknown" : p.online ? "Online" : "Offline"}</span></span></li>)}</ul></section>
        <section className="space-y-3 border-t border-slate-200 pt-4"><h2 className="font-semibold">Event info</h2><dl className="space-y-3 text-sm">
          <div><dt className="text-slate-500">Candidate</dt><dd>{event.candidate_name || "No candidate linked"}</dd></div>
          <div><dt className="text-slate-500">Event</dt><dd>{event.title}</dd></div>
          <div><dt className="text-slate-500">Application job title</dt><dd>{event.job_title || "No application linked"}</dd></div>
        </dl></section>
        <section className="mt-auto space-y-4 border-t border-slate-200 pt-4">{snapshot ? <>
          <MeetingLink readOnly={!canEditMeeting} label="Real meeting link" value={snapshot.links.meeting_link} version={snapshot.links.meeting_version} save={saveLink("meeting")} />
          <MeetingLink label="Support meeting link" value={snapshot.links.support_link} version={snapshot.links.support_version} save={saveLink("support")} />
        </> : <p className="text-sm">Loading shared links…</p>}</section>
      </aside>
      <section className={`${cardClass} flex min-w-0 flex-col p-4`}>
        <div role="tablist" aria-label="Session content" className="mb-4 flex flex-wrap border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">{(["chat", "copilot", "gpt", ...(candidatePanel && applicationPanel ? ["candidate", "application"] as const : [])] as const).map(kind => <button key={kind} role="tab" aria-selected={tab === kind} className={`-mb-px border-b-2 px-5 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500 ${tab === kind ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"}`} onClick={() => { follow.current = true; setTab(kind); }}>{({ chat: "Chats", copilot: "Copilot", candidate: "Candidate", application: "Application", gpt: "GPT" })[kind]}</button>)}</div>
        <div className={tab === "gpt" ? "min-w-0 space-y-4" : "hidden"}>{tab === "gpt" ? <>{briefPanel}{gptPanel}</> : null}</div>
        {tab === "gpt" ? null : showMessages ? <>
        <div role="tabpanel" aria-label={tab === "chat" ? "Chats" : "Copilot"} className="h-[50vh] min-h-64 space-y-3 overflow-y-auto [overflow-anchor:none]" onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {!messages.some(m => m.kind === tab) ? <p className="text-sm text-slate-500">{tab === "chat" ? "Start the conversation." : "Share an answer with everyone in this session."}</p> : null}
          {messages.filter(m => m.kind === tab).map((m, index) => <article key={m.sequence} className={`rounded-xl border p-3 ${tab === "chat"
            ? m.user_id === userId
              ? "ml-auto w-fit max-w-[85%] border-indigo-100 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/50"
              : "mr-auto w-fit max-w-[85%] border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
            : index % 2 === 0
              ? "border-slate-200 border-l-4 border-l-indigo-400 bg-indigo-50/60 shadow-sm dark:border-slate-700 dark:border-l-indigo-400 dark:bg-indigo-950/30"
              : "border-slate-200 border-l-4 border-l-teal-400 bg-teal-50/60 shadow-sm dark:border-slate-700 dark:border-l-teal-400 dark:bg-teal-950/30"}`}>
            <div className={`flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 ${tab === "copilot" ? "mb-3 border-b border-slate-200/70 pb-2 dark:border-slate-700" : "mb-1"}`}>
              <span className="flex flex-wrap items-center gap-2">{tab === "copilot" ? <span className="rounded bg-white/80 px-2 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Answer {index + 1}{m.streaming ? " · Generating…" : ""}</span> : null}<span className="font-medium">{m.name}{m.user_id === userId ? " (you)" : ""}</span></span>
              <time dateTime={m.sent_at}>{new Date(m.sent_at).toLocaleTimeString()}</time>
            </div>
            <p className={`whitespace-pre-wrap break-words font-sans ${tab === "copilot" ? "text-base leading-7" : "text-sm leading-6"}`}>{m.body}</p></article>)}<div ref={bottom} />
        </div>
        <form className="mt-4 space-y-2" onSubmit={e => { e.preventDefault(); void send(); }}>
          <label className="block text-sm">{tab === "chat" ? "Message" : "Answer"}<textarea className={`${inputClass} mt-1 w-full`} rows={3} maxLength={20000} disabled={sending} value={drafts[messageKind]} onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!sending && snapshot) void send();
            }
          }} onChange={e => setDrafts(prev => ({ ...prev, [messageKind]: e.target.value }))} /></label>
          <p className="text-xs text-slate-500">Enter to send · Shift+Enter for a new line</p>
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          <button className={btnPrimary} disabled={sending || !drafts[messageKind].trim() || !snapshot}>{sending ? "Sending…" : tab === "chat" ? "Send message" : "Send answer"}</button>
        </form>
        </> : <div role="tabpanel" aria-label={tab === "candidate" ? "Candidate" : "Application"} className="h-[50vh] min-h-64 min-w-0 overflow-x-hidden overflow-y-auto [overflow-anchor:none]">{tab === "candidate" ? candidatePanel : applicationPanel}</div>}
      </section>
    </div>
  </div>;
}
