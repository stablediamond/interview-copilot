"use client";

import * as React from "react";
import { toast } from "sonner";
import { LogIn, LogOut } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/client";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";
import {
  getStoredEmail,
  getValidAccessToken,
  signIn,
  signOut,
} from "@/lib/job-track-auth";

type Status = "loading" | "in" | "out";

/**
 * Login gate backed by Job Track. When Job Track isn't configured this is a
 * pass-through. Otherwise the whole app is hidden behind a sign-in screen, and
 * the protected API routes independently verify the token.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [email, setEmail] = React.useState("");
  const [configured, setConfigured] = React.useState(false);

  React.useEffect(() => {
    const gateOn = isJobTrackConfigured();
    setConfigured(gateOn);
    if (!gateOn) {
      setStatus("in");
      return;
    }
    void (async () => {
      const token = await getValidAccessToken();
      if (!token) {
        setStatus("out");
        return;
      }
      setEmail(getStoredEmail() ?? "");
      setStatus("in");
      try {
        await apiFetch("/api/auth/session");
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        const revoked =
          /invalid|revoked|pending|suspended|sign in/i.test(message) &&
          !/could not reach/i.test(message);
        if (revoked) {
          await signOut();
          setEmail("");
          setStatus("out");
        }
      }
    })();
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (status === "out") {
    return (
      <LoginScreen
        onSignedIn={(e) => {
          setEmail(e);
          setStatus("in");
        }}
      />
    );
  }

  return (
    <>
      {configured && (
        <SignOutButton
          email={email}
          onSignedOut={() => {
            setStatus("out");
            setEmail("");
          }}
        />
      )}
      {children}
    </>
  );
}

function LoginScreen({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      onSignedIn(email.trim().toLowerCase());
    } catch (err) {
      toast.error("Sign in failed", {
        description: err instanceof Error ? err.message : "Check your Job Track credentials.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Use your Job Track email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : <LogIn className="h-4 w-4" />}{" "}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No account?{" "}
              <a
                href={`${getJobTrackUrl()}/signup`}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Sign up on Job Track
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SignOutButton({
  email,
  onSignedOut,
}: {
  email: string;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      onSignedOut();
    }
  };

  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
      {email && <span className="max-w-[160px] truncate">{email}</span>}
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handle} disabled={busy}>
        {busy ? <Spinner /> : <LogOut className="h-3.5 w-3.5" />} Sign out
      </Button>
    </div>
  );
}
