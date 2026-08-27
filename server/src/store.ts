// SQLite-backed storage using better-sqlite3. The exported function signatures
// are identical to the previous JSON-file store, so no callers need to change.
//
// Design notes:
// - One row per assignment. The questions array is stored as a JSON string in a
//   `questions` column. This keeps the existing Assignment shape intact while
//   still giving us a real, queryable, transactional database.
// - Settings live in a single-row table (id = 1).
// - On first run, if an old data.json exists, its contents are imported once so
//   nobody loses data when upgrading.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  Assignment,
  AssignmentImage,
  Contact,
  DB,
  Question,
  Settings,
} from "./types.js";
import { correlateQuestionContext } from "./questionContext.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, "..", "data.sqlite");
const LEGACY_JSON = join(__dirname, "..", "data.json");

const DEFAULT_SETTINGS: Settings = {
  studentEmail: "",
  notifyEnabled: false,
  lastNotifiedAt: "",
};

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL"); // better concurrency and durability

db.exec(`
  CREATE TABLE IF NOT EXISTS assignments (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    course      TEXT NOT NULL,
    dueDate     TEXT NOT NULL,
    docMarkdown TEXT NOT NULL,
    questions   TEXT NOT NULL,  -- JSON array of Question
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    studentEmail  TEXT NOT NULL,
    notifyEnabled INTEGER NOT NULL,
    lastNotifiedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    email     TEXT NOT NULL UNIQUE, -- stored lowercase
    createdAt TEXT NOT NULL
  );
`);

// Migration: add the `images` column to existing databases (JSON array of
// AssignmentImage). New DBs get it here too; the default keeps old rows valid.
const assignmentCols = db
  .prepare("PRAGMA table_info(assignments)")
  .all() as { name: string }[];
if (!assignmentCols.some((c) => c.name === "images")) {
  db.exec("ALTER TABLE assignments ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
}

// Ensure exactly one settings row exists.
db.prepare(
  `INSERT OR IGNORE INTO settings (id, studentEmail, notifyEnabled, lastNotifiedAt)
   VALUES (1, ?, ?, ?)`
).run(DEFAULT_SETTINGS.studentEmail, DEFAULT_SETTINGS.notifyEnabled ? 1 : 0, DEFAULT_SETTINGS.lastNotifiedAt);

// ---- Row mapping helpers ---------------------------------------------------

interface AssignmentRow {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  docMarkdown: string;
  questions: string;
  images: string;
  createdAt: string;
}

function rowToAssignment(row: AssignmentRow): Assignment {
  let rawQuestions: Partial<Question>[] = [];
  try {
    rawQuestions = JSON.parse(row.questions) as Partial<Question>[];
  } catch {
    rawQuestions = [];
  }
  let images: AssignmentImage[] = [];
  try {
    images = (JSON.parse(row.images ?? "[]") as AssignmentImage[]).map((img) => ({
      ...img,
      sourcePath: img.sourcePath ?? "",
    }));
  } catch {
    images = [];
  }
  const questions = rawQuestions.map((question) => {
    const correlated =
      typeof question.context === "string"
        ? null
        : correlateQuestionContext(question.prompt ?? "", row.docMarkdown, images);
    return {
      id: question.id ?? "",
      prompt: question.prompt ?? "",
      context: question.context ?? correlated?.context ?? "",
      imageIds: question.imageIds ?? correlated?.imageIds ?? [],
      answer: question.answer ?? "",
      sources: question.sources ?? [],
      done: question.done ?? false,
    };
  });
  return {
    id: row.id,
    title: row.title,
    course: row.course,
    dueDate: row.dueDate,
    docMarkdown: row.docMarkdown,
    images,
    questions,
    createdAt: row.createdAt,
  };
}

// ---- One-time migration from the old JSON file -----------------------------

function migrateLegacyJson(): void {
  if (!existsSync(LEGACY_JSON)) return;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM assignments").get() as { n: number }).n;
  if (count > 0) return; // already have data; don't re-import

  try {
    const legacy = JSON.parse(readFileSync(LEGACY_JSON, "utf8")) as DB;
    const insertMany = db.transaction((data: DB) => {
      for (const a of data.assignments ?? []) {
        insertAssignmentStmt.run({
          id: a.id,
          title: a.title,
          course: a.course,
          dueDate: a.dueDate,
          docMarkdown: a.docMarkdown,
          questions: JSON.stringify(a.questions ?? []),
          images: JSON.stringify(a.images ?? []),
          createdAt: a.createdAt,
        });
      }
      if (data.settings) {
        saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      }
    });
    insertMany(legacy);
    // Keep a backup instead of deleting, so nothing is truly lost.
    renameSync(LEGACY_JSON, LEGACY_JSON + ".imported");
    console.log("[store] migrated data.json into SQLite (backup: data.json.imported)");
  } catch (err) {
    console.error("[store] legacy migration skipped:", (err as Error).message);
  }
}

// ---- Prepared statements ---------------------------------------------------

const insertAssignmentStmt = db.prepare(
  `INSERT INTO assignments (id, title, course, dueDate, docMarkdown, questions, images, createdAt)
   VALUES (@id, @title, @course, @dueDate, @docMarkdown, @questions, @images, @createdAt)
   ON CONFLICT(id) DO UPDATE SET
     title = excluded.title,
     course = excluded.course,
     dueDate = excluded.dueDate,
     docMarkdown = excluded.docMarkdown,
     questions = excluded.questions,
     images = excluded.images,
     createdAt = excluded.createdAt`
);

// ---- Public API (same signatures as before) --------------------------------

export function getAssignments(): Assignment[] {
  const rows = db
    .prepare("SELECT * FROM assignments ORDER BY createdAt ASC")
    .all() as AssignmentRow[];
  return rows.map(rowToAssignment);
}

export function getAssignment(id: string): Assignment | undefined {
  const row = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id) as
    | AssignmentRow
    | undefined;
  return row ? rowToAssignment(row) : undefined;
}

export function saveAssignment(assignment: Assignment): void {
  insertAssignmentStmt.run({
    id: assignment.id,
    title: assignment.title,
    course: assignment.course,
    dueDate: assignment.dueDate,
    docMarkdown: assignment.docMarkdown,
    questions: JSON.stringify(assignment.questions ?? []),
    images: JSON.stringify(assignment.images ?? []),
    createdAt: assignment.createdAt,
  });
}

export function deleteAssignment(id: string): void {
  db.prepare("DELETE FROM assignments WHERE id = ?").run(id);
}

export function getSettings(): Settings {
  const row = db.prepare("SELECT * FROM settings WHERE id = 1").get() as
    | { studentEmail: string; notifyEnabled: number; lastNotifiedAt: string }
    | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    studentEmail: row.studentEmail,
    notifyEnabled: !!row.notifyEnabled,
    lastNotifiedAt: row.lastNotifiedAt,
  };
}

export function saveSettings(settings: Settings): void {
  db.prepare(
    `UPDATE settings
       SET studentEmail = @studentEmail,
           notifyEnabled = @notifyEnabled,
           lastNotifiedAt = @lastNotifiedAt
     WHERE id = 1`
  ).run({
    studentEmail: settings.studentEmail,
    notifyEnabled: settings.notifyEnabled ? 1 : 0,
    lastNotifiedAt: settings.lastNotifiedAt,
  });
}

export function getDB(): DB {
  return { assignments: getAssignments(), settings: getSettings() };
}

// ---- Contacts (saved email recipients) -------------------------------------

interface ContactRow {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export function getContacts(): Contact[] {
  const rows = db
    .prepare("SELECT * FROM contacts ORDER BY createdAt ASC")
    .all() as ContactRow[];
  return rows.map((r) => ({ ...r }));
}

/** Add a contact, or update the name if the email already exists. */
export function addContact(name: string, email: string): Contact {
  const cleanEmail = email.trim().toLowerCase();
  const existing = db
    .prepare("SELECT * FROM contacts WHERE email = ?")
    .get(cleanEmail) as ContactRow | undefined;
  if (existing) {
    const nextName = name.trim() || existing.name;
    db.prepare("UPDATE contacts SET name = ? WHERE id = ?").run(
      nextName,
      existing.id
    );
    return { id: existing.id, name: nextName, email: cleanEmail, createdAt: existing.createdAt };
  }
  const contact: Contact = {
    id: randomUUID(),
    name: name.trim(),
    email: cleanEmail,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO contacts (id, name, email, createdAt) VALUES (@id, @name, @email, @createdAt)"
  ).run(contact);
  return contact;
}

export function deleteContact(id: string): void {
  db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
}

// Run migration after the API is defined (it uses saveSettings).
migrateLegacyJson();
