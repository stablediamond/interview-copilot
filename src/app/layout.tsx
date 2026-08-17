import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteNav } from "@/components/site-nav";
import { ElectronTitlebar } from "@/components/electron-titlebar";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Interview Coach",
  description:
    "Local-first real-time interview assistant for personal preparation and permitted live coaching.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthGate>
            <div className="flex min-h-screen flex-col">
              <ElectronTitlebar />
              <SiteNav />
              <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
            </div>
          </AuthGate>
          <Toaster richColors position="top-center" theme="dark" />
        </ThemeProvider>
      </body>
    </html>
  );
}
