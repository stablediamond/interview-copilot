# Interview Coach

A local-first, real-time interview assistant for **your own interview preparation and permitted live coaching**. You add your resume and the job description, start a session, and the app listens to audio (or accepts pasted captions), detects the interviewer's latest real question, and drafts a short, natural, senior-level spoken answer grounded in your resume and the JD.

> This is a personal coach and note assistant only. It has **no** stealth mode, screen reading, proctoring evasion, auto-answer injection, fake typing, or any hidden behavior. It only does what you can see on screen.

## Features

- **Setup** — paste or upload (`.txt` / `.pdf`) your resume, paste a job description, and extract structured candidate and job profiles.
- **Story bank** — full CRUD over reusable stories with short, STAR, and technical versions; generate missing stories from your resume and improve tone.
- **Live session** — Deepgram streaming transcription (or manual caption paste), live question detection, and grounded answer generation with multiple rewrite modes.
- **History** — review past sessions, export to Markdown, and generate a post-interview review (questions asked, strong/weak answers, missing prep areas, and a follow-up email draft).
- **Settings** — model/key status, answer defaults, transcript window, auto-answer toggle, bold keywords, theme, and a delete-all-data control.
- Clean dark UI, keyboard-first workflow, loading/empty/error states, and toast notifications.

## Tech stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS · shadcn/ui-style components · Prisma + SQLite · OpenAI Responses API · Deepgram WebSocket STT · Zod · Zustand-free local React state.

## Prerequisites

- Node.js 18.18+ (Node 20+ recommended)
- An OpenAI API key
- (Optional) a Deepgram API key for live audio transcription

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env and add your keys (see below)

# 3. Create the local SQLite database and tables
npx prisma migrate dev

# 4. (Optional) seed sample story-bank entries
npm run seed

# 5. Start the dev server
npm run dev
```

Open http://localhost:3000.

### Environment variables

You can configure the OpenAI key and models **either** in the Settings UI **or** via `.env`. The Settings UI (stored locally in your database) takes precedence; `.env` acts as a fallback default.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | If not set in UI | — | Enables resume/JD analysis, question detection, answers, and transcription |
| `OPENAI_MODEL` | No | `gpt-4.1` | Strong model for answers, story generation, and reviews |
| `OPENAI_FAST_MODEL` | No | `gpt-4.1-mini` | Fast model for question detection |
| `DEEPGRAM_API_KEY` | No | — | Optional low-latency mic streaming. If missing, OpenAI transcribes audio instead |
| `DATABASE_URL` | No | `file:./dev.db` | SQLite database location |

The app never sends your API keys to the browser. The OpenAI key is stored server-side and only ever shown masked. For Deepgram, the server mints a short-lived JWT via `/v1/auth/grant`, and only that temporary token reaches the client.

### Configuring your key & models in the app

On **Settings → OpenAI key & models**:

1. Paste your OpenAI key and **Save key** (stored locally, never displayed in full).
2. Click **Test & load models** — the app lists the chat and transcription models your key can actually access and marks a **★ recommended** option for best quality (answer model), speed (detection model), and transcription.
3. Pick models (or **Use recommended**) and **Save models**.

### Live audio capture (Google Meet / Zoom / browser / apps)

The Session page has a capture-source selector:

- **Microphone** — captures your voice (and the interviewer only if they're on a loudspeaker). Uses Deepgram if configured, otherwise OpenAI.
- **Meeting tab audio** — uses the browser's screen-share to capture audio from a shared tab/window. For **Google Meet / Zoom in the browser**, share that tab and enable **"Share tab audio"**. For the **Zoom/Meet desktop apps**, route system audio through a virtual loopback device (e.g. **BlackHole** on macOS, **VB-Cable** on Windows) and share/select it. Transcribed by OpenAI in short ~5s segments.

With only an OpenAI key (no Deepgram), live transcription still works — audio is recorded in short self-contained segments and transcribed via OpenAI.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Generate Prisma client and build for production |
| `npm run start` | Start the production server (after `build`) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript in `--noEmit` mode |
| `npm run prisma:migrate` | Run Prisma migrations (`prisma migrate dev`) |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run seed` | Seed sample story-bank entries |
| `npm run electron:dev` | Run the desktop overlay against the dev server |
| `npm run electron:start` | Build, then run the desktop overlay in production mode |
| `npm run dist:win` | Build the packaged Windows installer (run on Windows) |

## Desktop overlay (Electron)

For live calls, run the app as an always-on-top floating window that sits over
Zoom / Meet / Teams:

```bash
npm run electron:dev      # development (hot reload)
# or
npm run electron:start    # production build
```

- The window stays on top of other apps. Drag it by the top bar; use the pin
  button to toggle always-on-top, plus minimize / close.
- **Global hotkeys** work even when the call window is focused:
  - `Cmd/Ctrl + Shift + Enter` — generate an answer
  - `Cmd/Ctrl + Shift + \` — show / hide the overlay
- The overlay can capture **system / meeting audio** via the OS picker. On
  Linux this uses the PulseAudio/PipeWire monitor source; on macOS you need a
  loopback device (e.g. BlackHole); on Windows it uses WASAPI loopback.

### Windows Live Captions capture (fastest on Windows)

In the desktop app on **Windows 11**, the capture-source dropdown adds
**“Windows Live Captions.”** This reads the on-device caption text directly via
UI Automation — no STT API, no upload, and very low latency, because Windows has
already recognised the speech locally.

1. Enable Live Captions once: **Win + Ctrl + L**.
2. In Live Captions settings, set it to caption **system audio** so it hears the
   interviewer (and your mic too, if you want both sides).
3. In Interview Coach, choose **Windows Live Captions** as the capture source and
   press Record.

Notes: captions are a single mixed stream (not split by speaker), which is fine
for detecting the latest question. This source is undocumented by Microsoft, so
it can change with Windows updates; Deepgram/OpenAI remain available as
cross-platform fallbacks.
- Linux note: the scripts pass `--no-sandbox` so it launches without the
  root-owned `chrome-sandbox` helper. To keep the sandbox instead, run
  `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`.

## Packaging a Windows installer

The desktop app bundles its own server and database, so end users just install
and run — no Node, no source, no terminal.

**Build it (two ways):**

- **On a Windows 11 machine:** `npm install` then `npm run dist:win`. The
  installer appears in `release/` as `Interview Coach-Setup-<version>.exe`.
- **Via GitHub Actions (recommended):** the `Build Windows installer` workflow
  builds on `windows-latest`.
  - **Manual run** (Actions tab): produces a downloadable `.exe` artifact.
  - **Tag push** (`git tag v1.0.0 && git push --tags`): builds **and publishes a
    GitHub Release** with the installer + update metadata.

> The installer must be built on Windows (so Prisma's Windows query engine is
> generated). Building from Linux/macOS won't produce a working Windows app.

### Auto-updates

The packaged app uses `electron-updater` to check **GitHub Releases** on launch
and install newer versions in the background. To ship an update: bump the
`version` in `package.json`, commit, then push a matching tag (e.g. `v1.0.1`).
The workflow publishes the Release, and installed apps update themselves on next
launch. (Requires the repo's GitHub Releases to be public, or a token for
private repos.)

> Packaging note: electron-builder skips nested directories named
> `node_modules` inside `extraResources`, so the bundled server's dependencies
> are copied via a second explicit `extraResources` entry
> (`.next/standalone/node_modules` → `server/node_modules`). Without it the app
> crashes with `Cannot find module 'next'`.

**What the packaged app does at runtime:**

- Runs the Next.js **standalone** server with Electron's bundled Node.
- Copies a pre-migrated SQLite database into the user's profile folder
  (`%APPDATA%/interview-coach`) on first launch, so data persists and is
  writable.
- Each install is fully independent: its own database, settings, and API key
  (entered in-app on first run). There's no shared server or accounts — for
  centrally-managed users/roles you'd deploy the web app instead.

## Keyboard shortcuts (Session page)

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + Enter` | Generate answer (default mode) |
| `Cmd/Ctrl + Shift + S` | Make answer shorter |
| `Cmd/Ctrl + Shift + T` | Make answer more technical |
| `Cmd/Ctrl + Shift + H` | Make answer more human |
| `Cmd/Ctrl + Shift + R` | Regenerate |

## How a session works

1. On **Setup**, analyze your resume and a job description (use **Load sample data** to try it quickly).
2. Optionally generate a **story bank**.
3. On **Session**, pick the candidate and job profiles.
4. Choose a capture source (Microphone or Meeting tab audio) and start recording, or paste captions into the manual box.
5. The app detects the latest interviewer question (debounced — never per partial word). Generate with the buttons or keyboard shortcuts.
6. **Save turn** to persist the question/answer. Review everything later on **History**, where you can export Markdown and generate a post-interview review.

## Grounding & safety

- Answers use only your structured profile, top-ranked resume facts, JD requirements, and approved stories (selected deterministically by keyword overlap).
- The model is instructed not to invent companies, tools, metrics, projects, titles, or years.
- A **confidence** label reflects evidence strength, and a **risk note** warns when an answer leans on weak support.
- The **Safer** mode rewrites an answer to remove unsupported claims.

## Access gate (Supabase Auth login)

You can ship a build that only works for accounts you've created, using
**Supabase Authentication**. No tables and no SQL are required — access is the
built-in `auth.users` list, managed from the dashboard. Only **public** values
are embedded in the app (project URL + anon key); the `service_role` key is
never used.

1. In `src/lib/supabase.ts`, paste your `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   (anon/public key only). While these are blank the gate is **off** and the app
   works normally.
2. In the Supabase dashboard:
   - **Authentication → Providers → Email**: enable it.
   - **Authentication → Providers** (or Settings): turn **off** "Allow new users
     to sign up" so only you can add accounts.
   - **Authentication → Users → Add user**: create an account (email + password)
     for each person who should have access.
3. Control access from **Authentication → Users**:
   - Grant access: add a user.
   - Revoke access: delete or ban the user. They lose access within the access
     token's lifetime (≈1 hour) — refresh and new logins are rejected
     immediately. To cut everyone off at once, rotate the anon key.

On launch the app shows a sign-in screen. The OpenAI/Deepgram-backed API routes
also verify the user's token server-side (return 401 when missing/revoked), with
a short cache so a brief network blip won't kick out a signed-in user
mid-session.

## Project structure

```
prisma/                 Prisma schema, migrations, and seed
src/app/                App Router pages and API routes
src/app/api/            JSON API endpoints (all validated with Zod)
src/components/         UI components (shadcn/ui-style primitives + app components)
src/hooks/              useSettings, useDeepgram
src/lib/                db, llm wrapper, prompts, schemas, context selection, helpers
```

## Notes

- The database file (`prisma/dev.db`) and `.env` are git-ignored.
- If a PDF is scanned/image-only, paste the resume text instead — the uploader returns a clear message.
- The app degrades gracefully when keys or profiles are missing: it shows helpful messages instead of crashing.
