// Express API. Endpoints:
//   POST   /api/assignments            (multipart: doc file + title/course/dueDate) -> ingest + extract questions
//   GET    /api/assignments            -> list with progress
//   GET    /api/assignments/:id        -> one assignment (full, with questions)
//   DELETE /api/assignments/:id
//   POST   /api/assignments/:id/questions/:qid/solve  -> agent solves via doc + web search
//   PATCH  /api/assignments/:id/questions/:qid        -> update answer/done
//   GET    /api/settings   PUT /api/settings
//   POST   /api/notify/test -> send reminder email now

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Load .env from the project root (one level above server/).
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });

import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";

import {
  getAssignments,
  getAssignment,
  saveAssignment,
  deleteAssignment,
  getSettings,
  saveSettings,
} from "./store.js";
import { ingestDocument } from "./ingest.js";
import { extractQuestions, solveQuestion, newQuestion } from "./agent.js";
import { computeProgress } from "./progress.js";
import { sendReminderNow, startScheduler } from "./notify.js";
import type { Assignment } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: (err as Error).message });
    });
  };

// --- Assignments ------------------------------------------------------------

// Create: upload a document, ingest to markdown, extract questions via agent.
app.post(
  "/api/assignments",
  upload.single("document"),
  wrap(async (req, res) => {
    const { title, course, dueDate } = req.body as Record<string, string>;
    if (!req.file) {
      res.status(400).json({ error: "No document uploaded." });
      return;
    }
    const { markdown } = await ingestDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    const prompts = await extractQuestions(markdown);
    const assignment: Assignment = {
      id: randomUUID(),
      title: title?.trim() || req.file.originalname,
      course: course?.trim() || "General",
      dueDate: dueDate?.trim() || "",
      docMarkdown: markdown,
      questions: prompts.map((p) => newQuestion(randomUUID(), p)),
      createdAt: new Date().toISOString(),
    };
    saveAssignment(assignment);
    res.json({ assignment, progress: computeProgress(assignment) });
  })
);

// List (summary + progress, no heavy markdown).
app.get(
  "/api/assignments",
  wrap(async (_req, res) => {
    const list = getAssignments().map((a) => ({
      id: a.id,
      title: a.title,
      course: a.course,
      dueDate: a.dueDate,
      createdAt: a.createdAt,
      progress: computeProgress(a),
    }));
    res.json({ assignments: list });
  })
);

// One full assignment.
app.get(
  "/api/assignments/:id",
  wrap(async (req, res) => {
    const a = getAssignment(req.params.id);
    if (!a) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ assignment: a, progress: computeProgress(a) });
  })
);

app.delete(
  "/api/assignments/:id",
  wrap(async (req, res) => {
    deleteAssignment(req.params.id);
    res.json({ ok: true });
  })
);

// Agent solves one question using the document + web search.
app.post(
  "/api/assignments/:id/questions/:qid/solve",
  wrap(async (req, res) => {
    const a = getAssignment(req.params.id);
    if (!a) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    const q = a.questions.find((x) => x.id === req.params.qid);
    if (!q) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const { answer, sources, usedWebSearch } = await solveQuestion(
      q.prompt,
      a.docMarkdown
    );
    q.answer = answer;
    q.sources = sources;
    saveAssignment(a);
    res.json({ question: q, progress: computeProgress(a), usedWebSearch });
  })
);

// Update a question (edit answer or toggle done).
app.patch(
  "/api/assignments/:id/questions/:qid",
  wrap(async (req, res) => {
    const a = getAssignment(req.params.id);
    if (!a) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    const q = a.questions.find((x) => x.id === req.params.qid);
    if (!q) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    const { answer, done } = req.body as { answer?: string; done?: boolean };
    if (typeof answer === "string") q.answer = answer;
    if (typeof done === "boolean") q.done = done;
    saveAssignment(a);
    res.json({ question: q, progress: computeProgress(a) });
  })
);

// --- Settings + notifications ----------------------------------------------

app.get(
  "/api/settings",
  wrap(async (_req, res) => {
    res.json({ settings: getSettings() });
  })
);

app.put(
  "/api/settings",
  wrap(async (req, res) => {
    const current = getSettings();
    const { studentEmail, notifyEnabled } = req.body as {
      studentEmail?: string;
      notifyEnabled?: boolean;
    };
    const next = {
      ...current,
      studentEmail: studentEmail ?? current.studentEmail,
      notifyEnabled: notifyEnabled ?? current.notifyEnabled,
    };
    saveSettings(next);
    res.json({ settings: next });
  })
);

// Send a reminder email right now (for testing / manual trigger).
app.post(
  "/api/notify/test",
  wrap(async (_req, res) => {
    const result = await sendReminderNow();
    res.json(result);
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, geminiConfigured: !!process.env.GEMINI_API_KEY });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  startScheduler();
});
