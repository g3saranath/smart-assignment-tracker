// Tiny JSON-file "database". Good enough for a student project; swap for
// SQLite/Postgres later. All reads/writes go through here.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Assignment, DB, Settings } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data.json");

const DEFAULT_SETTINGS: Settings = {
  studentEmail: "",
  notifyEnabled: false,
  lastNotifiedAt: "",
};

function read(): DB {
  if (!existsSync(DATA_FILE)) {
    return { assignments: [], settings: { ...DEFAULT_SETTINGS } };
  }
  try {
    const raw = readFileSync(DATA_FILE, "utf8");
    const db = JSON.parse(raw) as DB;
    db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
    db.assignments ??= [];
    return db;
  } catch {
    return { assignments: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

function write(db: DB): void {
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function getAssignments(): Assignment[] {
  return read().assignments;
}

export function getAssignment(id: string): Assignment | undefined {
  return read().assignments.find((a) => a.id === id);
}

export function saveAssignment(assignment: Assignment): void {
  const db = read();
  const idx = db.assignments.findIndex((a) => a.id === assignment.id);
  if (idx >= 0) db.assignments[idx] = assignment;
  else db.assignments.push(assignment);
  write(db);
}

export function deleteAssignment(id: string): void {
  const db = read();
  db.assignments = db.assignments.filter((a) => a.id !== id);
  write(db);
}

export function getSettings(): Settings {
  return read().settings;
}

export function saveSettings(settings: Settings): void {
  const db = read();
  db.settings = settings;
  write(db);
}

export function getDB(): DB {
  return read();
}
