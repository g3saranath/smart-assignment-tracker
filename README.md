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

For a diagram of how the agent is designed and how data flows through it, see
[ARCHITECTURE.md](ARCHITECTURE.md).

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
on port 4173. Leave this terminal window open; it must stay running while you use the
app.

Open your web browser and go to:

```
http://localhost:4173
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

## Examples

### A sample document to try

The repository includes a ready-to-use file at
[`examples/sample-assignment.md`](examples/sample-assignment.md). Upload it in Step 7 to
see the full flow without preparing your own document. It contains five physics
questions, including ones that produce formulas and math in the answers.

### What the agent extracts

After uploading the sample, the agent reads the document and produces a checklist of the
individual questions, for example:

```
Q1  State Newton's second law of motion and write its equation.
Q2  A 2 kg block is pushed with a net force of 10 N across a frictionless
    surface. What is its acceleration?
Q3  Explain the difference between speed and velocity in one or two sentences.
Q4  A car accelerates uniformly from rest to 20 m/s in 5 seconds. Calculate
    its acceleration and the distance travelled during this time.
Q5  Briefly describe what kinetic energy is and give its formula.
```

Each question gets its own card with a checkbox and a "Solve with agent" button.

### What a solved answer looks like

When you click "Solve with agent", the answer is rendered as formatted text, not raw
markdown. Headings, bold, lists, and math all display properly. For question 2 above, the
agent produces something like:

> **Answer**
>
> Using Newton's second law, `F = m * a`, so `a = F / m`.
>
> Substituting the values: `a = 10 N / 2 kg = 5 m/s^2`.
>
> The block accelerates at **5 meters per second squared** in the direction of the force.

Mathematical expressions written in LaTeX (for example an equation like the kinetic
energy formula) are rendered with proper notation rather than shown as plain characters.

### Sources and web search

If the web-search tool was available for that request, a "Sources" list appears under the
answer with links the agent consulted. On the free tier the search tool is often
rate-limited; when that happens the app still answers from the document and its own
knowledge, and the status message notes that web search was skipped. See the
Troubleshooting section for details.

---

## Optional: email reminders

Reminder emails are off until you configure an email account to send from. Gmail is the
easiest. Gmail does not let apps sign in with your normal password, so you create a
special 16-character "App Password" just for this app.

### Step A: Create a Gmail App Password

1. Sign in to the Gmail account you want to send from.
2. Turn on 2-Step Verification. Go to https://myaccount.google.com/security, find
   "2-Step Verification", and follow the prompts. App Passwords do not exist until
   2-Step Verification is on.
3. Open the App Passwords page: https://myaccount.google.com/apppasswords
   (If the page says it is not available, make sure Step 2 is complete and that you are
   using a personal Gmail account. Some school or work accounts disable this feature.)
4. Type a name to remember it by, for example "Assignment Tracker", and click Create.
5. Google shows a 16-character password, displayed in four groups like
   `abcd efgh ijkl mnop`. Copy it now, because Google will not show it again.
6. You can remove the spaces when you paste it. `abcd efgh ijkl mnop` and
   `abcdefghijklmnop` both work.

Keep this password private. It only allows sending email from this one account, and you
can delete it anytime from the same App Passwords page.

### Step B: Put the credentials in your .env file

In your `.env` file, fill in:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_16_character_app_password
SMTP_FROM=you@gmail.com
```
`SMTP_USER` and `SMTP_FROM` are your Gmail address. `SMTP_PASS` is the App Password from
Step A, not your normal Gmail password.

### Step C: Restart and test

1. Restart the app (`Ctrl + C`, then `npm run dev`).
2. In the app, open the Notifications section, enter the student email, enable reminders,
   and click "Send test reminder now".
3. Check the inbox (and the Spam folder the first time) for the reminder email.

If sending fails, the app will tell you what is wrong, for example a missing field or a
rejected password. The most common cause is using the normal Gmail password instead of
the App Password from Step A.

### When are reminder emails sent?

There are two ways an email goes out:

- Manual: the "Send test reminder now" button sends immediately, every time you click it,
  regardless of timing. This is the easiest way to confirm setup works.
- Automatic: while the app is running, a background scheduler checks the assignments once
  every hour and sends a reminder when all of these are true:
  - Reminders are enabled and a student email is set in the Notifications section.
  - There is at least one pending assignment (an assignment that is not fully complete).
  - At least 12 hours have passed since the last reminder was sent, so the student is not
    emailed more than about twice a day.

Notes:
- The scheduler only runs while `npm run dev` (or the built server) is running. If the app
  is closed, no automatic emails are sent until it is started again.
- The email contains a summary of every pending assignment, including how many questions
  are completed versus remaining and how close each due date is.
- Timing values live in `server/src/notify.ts` (`startScheduler`): the hourly check and
  the 12-hour minimum gap can be adjusted there if you want reminders more or less often.

---

## Troubleshooting

**"command not found: npm" (or node).** Node.js is not installed or the terminal was
opened before installing it. Install Node, then close and reopen the terminal.

**Port already in use.** Another program (or an old copy of this app) is using port
4173 or 3001. Close the other program, or stop the previous run with `Ctrl + C`.

**429 error with "limit: 0" when solving or extracting.** Your Gemini key's project
has no free-tier quota for the requested model. Create a new key using "Create API key
in a new project" at https://aistudio.google.com/apikey, and set `GEMINI_MODEL` in
`.env` to a model your key can access. Newer keys generally have access to
`gemini-flash-latest`, which is the default. Older model names such as
`gemini-2.0-flash` or `gemini-2.5-flash` may be blocked for new keys. The app already
retries automatically for ordinary rate limits.

**429 error only when using "Solve with agent" (web search).** The "Solve" feature uses
Gemini's Google Search grounding (web search) tool. On the free tier this specific tool
has a much lower quota than plain text calls, so extracting questions can succeed while
solving fails with a 429. This is a Google-side limit, not a bug in the app. Options:
- Space out solve attempts (roughly one per minute) so the free-tier per-minute quota
  can recover. Results will be intermittent.
- Enable billing on the key's Google Cloud project to remove the throttle. Google Search
  grounding is free up to a monthly cap and then very low cost, so for a student project
  the bill is typically zero or a few cents.
- If you prefer no web search at all, remove the `tools: [{ googleSearch: {} }]` line in
  `server/src/agent.ts` (function `solveQuestion`). The agent will then answer from the
  uploaded document and its own knowledge, with no source links and no grounding quota
  limit.

**"GEMINI_API_KEY is not set."** The `.env` file is missing, or the key line still says
`your_key_here`. Recheck Step 5 and restart the app.

**Email test fails.** Double-check the App Password (not your normal password) and that
all four SMTP values are filled in. Restart the app after editing `.env`.

**Nothing happens when I upload.** Make sure the `npm run dev` terminal is still
running and that you opened http://localhost:4173 (not 3001) in the browser.

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

### About web search

"Solve with agent" uses Gemini's built-in Google Search grounding rather than a
separate search API. The call in `solveQuestion` passes `tools: [{ googleSearch: {} }]`,
and Gemini decides on its own whether to search, runs the searches server-side, and
folds the results into the answer. The code then reads the source URLs from
`groundingMetadata` and shows them under "Sources". Note that this grounded tool has a
much lower free-tier quota than plain text calls; see the Troubleshooting section if
solving returns a 429.

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
