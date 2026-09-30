"use client";
import { usePathname } from "next/navigation";
export function SessionMain({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <main className={`mx-auto w-full min-w-0 flex-1 px-4 py-6 ${path === "/session" ? "" : "max-w-7xl"}`}>{children}</main>;
}
