// Express API. Endpoints:
//   POST   /api/assignments            (multipart: doc file + title/course/dueDate) -> ingest (MinerU OCR for PDF/images) + extract questions
//   GET    /api/assignments            -> list with progress
//   GET    /api/assignments/:id        -> one assignment (full, with questions)
//   DELETE /api/assignments/:id
//   POST   /api/assignments/:id/questions/:qid/solve  -> agent solves via doc text + figures + web search
//   PATCH  /api/assignments/:id/questions/:qid        -> update answer/done
//   GET    /api/settings   PUT /api/settings
//   POST   /api/notify/test -> send reminder email now
//   POST   /api/export/email -> email client-generated PDFs to one/more addresses
//   GET/POST/DELETE /api/contacts -> saved recipients (name + email)
//   GET    /api/assets/*    -> static extracted figures

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
  getContacts,
  addContact,
  deleteContact,
} from "./store.js";
import { ingestDocument } from "./ingest.js";
import { extractQuestions, solveQuestion, newQuestion } from "./agent.js";
import type { ExtractedQuestion } from "./agent.js";
import { computeProgress } from "./progress.js";
import { sendReminderNow, sendPdfByEmail, startScheduler } from "./notify.js";
import {
  ASSETS_DIR,
  deleteAssignmentAssets,
  saveAssignmentImages,
} from "./assets.js";
import type { Assignment } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());
// Serve extracted document figures read-only (for the UI / exported PDF).
app.use("/api/assets", express.static(ASSETS_DIR));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
    const id = randomUUID();
    const { markdown, images } = await ingestDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    // Persist extracted figures to disk, then feed both text + figures to the agent.
    const savedImages = saveAssignmentImages(id, images);
    let extractedQuestions: ExtractedQuestion[];
    try {
      extractedQuestions = await extractQuestions(markdown, savedImages);
    } catch (err) {
      // Extraction failed after images were written — don't leak the files.
      deleteAssignmentAssets(id);
      throw err;
    }
    const assignment: Assignment = {
      id,
      title: title?.trim() || req.file.originalname,
      course: course?.trim() || "General",
      dueDate: dueDate?.trim() || "",
      docMarkdown: markdown,
      images: savedImages,
      questions: extractedQuestions.map((question) => newQuestion(randomUUID(), question)),
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
    deleteAssignmentAssets(req.params.id);
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
    const linkedImages = a.images.filter((image) => q.imageIds.includes(image.id));
    const { answer, sources, usedWebSearch } = await solveQuestion(q, linkedImages);
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

// Email PDF exports to one or more recipients. The PDFs are built client-side
// with jsPDF (one per selected assignment) and uploaded as multipart form data:
//   pdf     -> repeated file field, one per assignment
//   emails  -> comma-separated recipient addresses
app.post(
  "/api/export/email",
  upload.array("pdf", 25),
  wrap(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const recipients = String(req.body?.emails || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const invalid = recipients.filter(
      (e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    );
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid email address: ${invalid.join(", ")}` });
      return;
    }
    if (recipients.length === 0) {
      res.status(400).json({ error: "Enter at least one email address." });
      return;
    }
    if (files.length === 0 || files.some((f) => f.size === 0)) {
      res.status(400).json({ error: "No PDF received." });
      return;
    }
    const result = await sendPdfByEmail({
      to: [...new Set(recipients)],
      files: files.map((f) => ({
        filename: f.originalname || "assignments.pdf",
        pdf: f.buffer,
      })),
    });
    res.json(result);
  })
);

// --- Contacts (saved email recipients) --------------------------------------

app.get(
  "/api/contacts",
  wrap(async (_req, res) => {
    res.json({ contacts: getContacts() });
  })
);

app.post(
  "/api/contacts",
  wrap(async (req, res) => {
    const { name, email } = req.body as { name?: string; email?: string };
    const cleanEmail = (email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    const contact = addContact(name || "", cleanEmail);
    res.json({ contact });
  })
);

app.delete(
  "/api/contacts/:id",
  wrap(async (req, res) => {
    deleteContact(req.params.id);
    res.json({ ok: true });
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
