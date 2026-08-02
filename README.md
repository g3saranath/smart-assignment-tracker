# 📚 Smart Assignment Tracker (TypeScript + React + Gemini)

An **agentic** assignment assistant. A student uploads an assignment document and the app:

1. **Ingests** the document (PDF / DOCX / TXT / MD) and converts it to **markdown**
2. **Extracts** the individual questions using a Gemini agent
3. **Solves** any question on demand — reading the document *and* doing live **web search** (Google Search grounding), returning an answer **with source links**
4. **Tracks the timeline** — due dates, how many questions are **completed vs. remaining**, and a progress bar per assignment
5. **Emails reminders** for pending assignments, including a progress summary

Cross-platform (Mac & Windows). No paid APIs required — Gemini has a free tier.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node + Express + TypeScript |
| AI agent | Google Gemini via the **new** `@google/genai` SDK (fixes the old `google.generativeai` deprecation) |
| Web search | Gemini **Google Search grounding** (no separate search key) |
| Docs → markdown | `pdf-parse` (PDF), `mammoth` (DOCX), native (TXT/MD) |
| Email | `nodemailer` (SMTP) |
| Storage | simple JSON file (`server/data.json`) |

---

## Setup (Mac & Windows)

### 1. Install everything
```bash
npm run install:all
```

### 2. Add your keys
Copy `.env.example` to `.env` and fill in:
```
GEMINI_API_KEY=...        # free: https://aistudio.google.com/apikey
# Email (optional — only for reminder emails):
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_gmail_app_password   # Google Account > Security > App passwords
SMTP_FROM=you@gmail.com
```

### 3. Run it (starts backend + frontend together)
```bash
npm run dev
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## How the agent works (for learning)

| Step | Code | Teaching point |
|------|------|----------------|
| Doc → markdown | `server/src/ingest.ts` | Normalizing messy inputs into clean text the model can reason over |
| Extract questions | `server/src/agent.ts` → `extractQuestions()` | LLM returns **structured JSON**, not prose |
| Solve w/ search | `server/src/agent.ts` → `solveQuestion()` | Tool use: `tools: [{ googleSearch: {} }]` + reading `groundingMetadata` for sources |
| Timeline/progress | `server/src/progress.ts` | Pure functions: completed vs. remaining, days-left, status |
| Email reminders | `server/src/notify.ts` | A scheduler that emails pending-assignment summaries |
| API | `server/src/index.ts` | REST endpoints wiring it together |
| UI | `client/src/App.tsx` | Upload, progress bars, per-question "Solve" + sources |

---

## Verified working

- ✅ Both workspaces typecheck (`npm run typecheck`)
- ✅ Client production build succeeds
- ✅ Server boots; health, settings, list, and notify endpoints tested
- ✅ Document ingestion + progress/timeline logic unit-tested
- ✅ Vite dev proxy forwards `/api` to the backend

> The question-extraction and solving features call Gemini, so they need a real
> `GEMINI_API_KEY` in `.env`. Email reminders need SMTP credentials. Everything
> else runs without any keys.

---

## 💡 Ideas for your student to extend it

- **Auto-detect due dates** from the document instead of typing them
- **"What should I do tonight?"** — one endpoint that plans the evening from all pending work
- **Streaming answers** so solutions appear token-by-token
- **Highlight citations** inline in the answer text
- **Swap JSON storage for SQLite** to learn a real database
- **Add auth** so multiple students have their own assignments
- **Browser push notifications** in addition to email
- **Confidence check** — a second agent that critiques the first answer before showing it

---

## Project layout
```
package.json          # workspace root (runs both apps)
.env.example          # keys template
server/               # Express + agent
  src/index.ts        # API routes
  src/agent.ts        # Gemini: extract + solve (web search)
  src/ingest.ts       # doc -> markdown
  src/progress.ts     # timeline/completion math
  src/notify.ts       # email reminders + scheduler
  src/store.ts        # JSON persistence
client/               # React + Vite UI
  src/App.tsx
  src/api.ts
  src/styles.css
```
