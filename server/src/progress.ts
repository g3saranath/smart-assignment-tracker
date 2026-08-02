// Progress + timeline calculations. Pure functions over an Assignment.

import type { Assignment } from "./types.js";

export interface Progress {
  total: number;
  completed: number;
  remaining: number;
  percent: number; // 0-100
  daysLeft: number | null; // null if no due date
  status: "overdue" | "due-today" | "due-soon" | "on-track" | "no-date" | "done";
}

export function daysUntil(dueDate: string): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate + "T00:00:00");
  if (isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = due.getTime() - today.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function computeProgress(a: Assignment): Progress {
  const total = a.questions.length;
  const completed = a.questions.filter((q) => q.done).length;
  const remaining = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const daysLeft = daysUntil(a.dueDate);

  let status: Progress["status"];
  if (total > 0 && completed === total) status = "done";
  else if (daysLeft === null) status = "no-date";
  else if (daysLeft < 0) status = "overdue";
  else if (daysLeft === 0) status = "due-today";
  else if (daysLeft <= 3) status = "due-soon";
  else status = "on-track";

  return { total, completed, remaining, percent, daysLeft, status };
}

/** Assignments that still have unfinished work, worst-deadline first. */
export function pendingAssignments(assignments: Assignment[]): Assignment[] {
  return assignments
    .filter((a) => {
      const p = computeProgress(a);
      return p.status !== "done";
    })
    .sort((a, b) => {
      const da = daysUntil(a.dueDate);
      const db = daysUntil(b.dueDate);
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
}
