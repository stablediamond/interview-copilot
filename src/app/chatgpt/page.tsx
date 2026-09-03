"use client";

import * as React from "react";
import { ChatGptWebview } from "@/components/chatgpt-webview";
import { getElectronAPI } from "@/lib/electron";

export default function ChatGptPage() {
  const [electron, setElectron] = React.useState(false);

  React.useEffect(() => {
    setElectron(getElectronAPI() !== null);
  }, []);

  // Titlebar (h-8) + site nav (h-14) when running in the desktop overlay.
  const topClass = electron ? "top-[5.5rem]" : "top-14";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col bg-background ${topClass}`}
    >
      <ChatGptWebview />
    </div>
  );
}
