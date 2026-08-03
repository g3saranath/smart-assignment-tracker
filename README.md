# Smart Assignment Tracker (TypeScript + React + Gemini)

An agentic assignment assistant. A student uploads an assignment document and the app:

1. Ingests the document (PDF, DOCX, TXT, or MD) and converts it to markdown.
2. Extracts the individual questions using a Gemini agent.
3. Solves any question on demand, reading the document and performing a live web
   search (Google Search grounding), returning an answer with source links.
4. Tracks the timeline: due dates, how many questions are completed versus remaining,
   and a progress bar per assignment.
5. Emails reminders for pending assignments, including a progress summary.

Cross-platform (Mac and Windows). No paid APIs are required; Gemini has a free tier.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node + Express + TypeScript |
| AI agent | Google Gemini via the `@google/genai` SDK |
| Web search | Gemini Google Search grounding (no separate search key) |
| Documents to markdown | `pdf-parse` (PDF), `mammoth` (DOCX), native (TXT/MD) |
| Email | `nodemailer` (SMTP) |
| Storage | Simple JSON file (`server/data.json`) |

---

## Reproduction guide (step by step)

This section is written so you can go from a fresh computer to a running app. Follow
it in order.

### Step 1: Install the prerequisites

You need two tools installed once.

**Node.js (version 18 or newer).** This runs both the backend and the frontend build.

- Download the "LTS" installer from https://nodejs.org and run it.
- Verify it worked by opening a terminal and running:
  ```bash
  node --version
  npm --version
  ```
  Both commands should print a version number. Node should be v18 or higher.

**Git.** This is used to download (clone) the project.

- Mac: it is usually already installed. Verify with `git --version`. If missing,
  install from https://git-scm.com or run `xcode-select --install`.
- Windows: download from https://git-scm.com and run the installer.

Opening a terminal:
- Mac: open the "Terminal" app (Applications > Utilities > Terminal).
- Windows: open "Git Bash" (installed with Git) or "PowerShell" from the Start menu.

### Step 2: Download the project

In your terminal, move to a folder where you keep projects, then clone the repository:

```bash
git clone https://github.com/g3saranath/smart-assignment-tracker.git
cd smart-assignment-tracker
```

You are now inside the project folder. All remaining commands are run from here.

### Step 3: Install the project dependencies

This downloads the libraries the app needs (into a `node_modules` folder). It may take
a minute.

```bash
npm run install:all
```

This single command installs the root, the `server`, and the `client` packages.

### Step 4: Get a free Gemini API key

The AI features (extracting and solving questions) need a Gemini key.

1. Go to https://aistudio.google.com/apikey and sign in with a Google account.
2. Click "Create API key". If you see an option, choose "Create API key in a new
   project". Keys made in a brand-new project are the most reliable for the free tier.
3. Copy the key. It is a long string of letters and numbers.

Note: keep this key private. Do not paste it into chat, email, or commit it to Git.

### Step 5: Create your configuration file

The project ships with a template named `.env.example`. You will make your own copy
called `.env` and paste your key into it.

- Mac / Git Bash / PowerShell:
  ```bash
  cp .env.example .env
  ```
  (If `cp` is not recognized in PowerShell, use `copy .env.example .env`.)

Open the new `.env` file in any text editor and set your key:

```
GEMINI_API_KEY=paste_your_key_here
```

Leave the other values as they are for now. The email settings are optional and only
needed for reminder emails (see the "Optional: email reminders" section below).

### Step 6: Run the app

Start the backend and frontend together with one command:

```bash
npm run dev
```

You should see messages saying the server is running on port 3001 and Vite is ready
on port 5173. Leave this terminal window open; it must stay running while you use the
app.

Open your web browser and go to:

```
http://localhost:5173
```

### Step 7: Try it end to end

1. In the app, use the "Add assignment" form. Optionally type a title, course, and due
   date.
2. Choose a document to upload. Any PDF, Word (.docx), text (.txt), or markdown (.md)
   file with some questions in it works. A short text file is fine for a first test.
3. Click "Upload and extract". The agent reads the document and lists the questions it
   found.
4. Click "Solve with agent" on a question. The agent answers using the document plus a
   web search, and shows the sources it used.
5. Check off questions as you finish. The progress bar and the completed-versus-
   remaining count update automatically.

### Step 8: Stopping and restarting

- To stop the app, return to the terminal running `npm run dev` and press `Ctrl + C`.
- To start it again later, run `npm run dev` from the project folder. Your data is
  saved in `server/data.json` between runs.

---

## Optional: email reminders

Reminder emails are off until you configure an email account to send from. Gmail is the
easiest.

1. Turn on 2-Step Verification for your Google account.
2. Create an "App Password": Google Account > Security > App passwords. Google gives you
   a 16-character password. This is not your normal Gmail password.
3. In your `.env` file, fill in:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=your_16_character_app_password
   SMTP_FROM=you@gmail.com
   ```
4. Restart the app (`Ctrl + C`, then `npm run dev`).
5. In the app, open the Notifications section, enter the student email, enable
   reminders, and use "Send test reminder now" to confirm it works.

---

## Troubleshooting

**"command not found: npm" (or node).** Node.js is not installed or the terminal was
opened before installing it. Install Node, then close and reopen the terminal.

**Port already in use.** Another program (or an old copy of this app) is using port
5173 or 3001. Close the other program, or stop the previous run with `Ctrl + C`.

**429 error with "limit: 0" when solving a question.** Your Gemini key's project has no
free-tier quota. Create a new key using "Create API key in a new project" at
https://aistudio.google.com/apikey. You can also set `GEMINI_MODEL` in `.env` to a
different model (for example `gemini-2.5-flash` or `gemini-1.5-flash`). The app already
retries automatically for ordinary rate limits.

**"GEMINI_API_KEY is not set."** The `.env` file is missing, or the key line still says
`your_key_here`. Recheck Step 5 and restart the app.

**Email test fails.** Double-check the App Password (not your normal password) and that
all four SMTP values are filled in. Restart the app after editing `.env`.

**Nothing happens when I upload.** Make sure the `npm run dev` terminal is still
running and that you opened http://localhost:5173 (not 3001) in the browser.

---

## How the agent works (for learning)

| Step | Code | Teaching point |
|------|------|----------------|
| Document to markdown | `server/src/ingest.ts` | Normalizing messy inputs into clean text the model can reason over |
| Extract questions | `server/src/agent.ts` (`extractQuestions`) | The model returns structured JSON, not prose |
| Solve with search | `server/src/agent.ts` (`solveQuestion`) | Tool use: `tools: [{ googleSearch: {} }]` plus reading `groundingMetadata` for sources |
| Timeline / progress | `server/src/progress.ts` | Pure functions: completed versus remaining, days left, status |
| Email reminders | `server/src/notify.ts` | A scheduler that emails pending-assignment summaries |
| API | `server/src/index.ts` | REST endpoints wiring it together |
| User interface | `client/src/App.tsx` | Upload, progress bars, per-question solve and sources |

---

## Useful commands

| Command | What it does |
|---------|--------------|
| `npm run install:all` | Install dependencies for root, server, and client |
| `npm run dev` | Run backend and frontend together (development) |
| `npm run typecheck` | Type-check both the server and the client |
| `npm run build` | Produce a production build of both |

---

## Project layout

```
package.json          Workspace root (runs both apps)
.env.example          Configuration template
server/               Express backend and agent
  src/index.ts        API routes
  src/agent.ts        Gemini: extract and solve (web search)
  src/ingest.ts       Document to markdown
  src/progress.ts     Timeline and completion math
  src/notify.ts       Email reminders and scheduler
  src/store.ts        JSON persistence
client/               React + Vite user interface
  src/App.tsx
  src/api.ts
  src/styles.css
```

---

## Ideas to extend it

- Auto-detect due dates from the document instead of typing them.
- Add a "What should I do tonight?" endpoint that plans the evening from all pending
  work.
- Stream answers so solutions appear as they are generated.
- Highlight citations inline in the answer text.
- Replace the JSON storage with SQLite to learn a real database.
- Add authentication so multiple students each have their own assignments.
- Add browser push notifications in addition to email.
- Add a confidence check: a second agent that critiques the first answer before it is
  shown.
