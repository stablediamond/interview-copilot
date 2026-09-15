"use client";

import * as React from "react";
import { ChatGptEmbed } from "@/components/chatgpt-embed";
import {
  ChatGptCapturePanel,
  type ChatGptCaptureHandle,
} from "@/components/chatgpt-capture-panel";
import { Textarea } from "@/components/ui/textarea";

const RIGHT_WIDTH_KEY = "interview-copilot.chatgpt-right-width";
const DEFAULT_RIGHT = 300;
const MIN_RIGHT = 260;
const MIN_LEFT = 280;

function readRightWidth() {
  if (typeof window === "undefined") return DEFAULT_RIGHT;
  const raw = Number(window.localStorage.getItem(RIGHT_WIDTH_KEY));
  return Number.isFinite(raw) ? Math.max(MIN_RIGHT, raw) : DEFAULT_RIGHT;
}

export function ChatGptSessionSplit({
  question,
  onQuestionChange,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
}) {
  const captureRef = React.useRef<ChatGptCaptureHandle>(null);
  const splitRef = React.useRef<HTMLDivElement | null>(null);
  const [rightWidth, setRightWidth] = React.useState(DEFAULT_RIGHT);
  const [dragging, setDragging] = React.useState(false);
  const rightWidthRef = React.useRef(rightWidth);
  rightWidthRef.current = rightWidth;

  React.useEffect(() => {
    setRightWidth(readRightWidth());
  }, []);

  const onSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = rightWidthRef.current;
    setDragging(true);

    const onMove = (move: PointerEvent) => {
      const parentWidth = splitRef.current?.parentElement?.clientWidth ?? 800;
      const maxRight = Math.max(MIN_RIGHT, parentWidth - MIN_LEFT);
      const next = Math.min(
        maxRight,
        Math.max(MIN_RIGHT, startWidth + (startX - move.clientX)),
      );
      rightWidthRef.current = next;
      setRightWidth(next);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragging(false);
      try {
        window.localStorage.setItem(
          RIGHT_WIDTH_KEY,
          String(rightWidthRef.current),
        );
      } catch {
        // ignore
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      className={`flex h-[min(78vh,820px)] min-h-[520px] overflow-hidden rounded-lg border border-border bg-background ${
        dragging ? "select-none" : ""
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatGptEmbed />
      </div>
      <div
        ref={splitRef}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onPointerDown={onSplitPointerDown}
        className={`w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/50 ${
          dragging ? "bg-primary/60" : ""
        }`}
      />
      <aside
        style={{ width: rightWidth }}
        className="flex shrink-0 flex-col gap-2 bg-card/95 p-2"
      >
        <div className="shrink-0 space-y-1">
          <p className="text-xs font-medium leading-none">
            Ask a specific question
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Optional. Leave blank to send the recorded caption instead.
          </p>
          <Textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void captureRef.current?.sendAnswer();
              }
            }}
            placeholder="e.g. Walk me through a system you designed for scale…"
            className="min-h-[72px] resize-none text-sm"
          />
        </div>
        <div className="min-h-0 flex-1">
          <ChatGptCapturePanel
            ref={captureRef}
            questionOverride={question}
          />
        </div>
      </aside>
    </div>
  );
}
