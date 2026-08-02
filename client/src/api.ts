// Shared client-side types + a tiny typed API wrapper.

export interface Question {
  id: string;
  prompt: string;
  answer: string;
  sources: string[];
  done: boolean;
}

export interface Progress {
  total: number;
  completed: number;
  remaining: number;
  percent: number;
  daysLeft: number | null;
  status: "overdue" | "due-today" | "due-soon" | "on-track" | "no-date" | "done";
}

export interface Assignment {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  docMarkdown: string;
  questions: Question[];
  createdAt: string;
}

export interface AssignmentSummary {
  id: string;
  title: string;
  course: string;
  dueDate: string;
  createdAt: string;
  progress: Progress;
}

export interface Settings {
  studentEmail: string;
  notifyEnabled: boolean;
  lastNotifiedAt: string;
}

async function json<T>(resPromise: Promise<Response>): Promise<T> {
  const res = await resPromise;
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAssignments: () =>
    json<{ assignments: AssignmentSummary[] }>(fetch("/api/assignments")),

  getAssignment: (id: string) =>
    json<{ assignment: Assignment; progress: Progress }>(
      fetch(`/api/assignments/${id}`)
    ),

  createAssignment: (form: FormData) =>
    json<{ assignment: Assignment; progress: Progress }>(
      fetch("/api/assignments", { method: "POST", body: form })
    ),

  deleteAssignment: (id: string) =>
    json<{ ok: boolean }>(fetch(`/api/assignments/${id}`, { method: "DELETE" })),

  solveQuestion: (id: string, qid: string) =>
    json<{ question: Question; progress: Progress }>(
      fetch(`/api/assignments/${id}/questions/${qid}/solve`, { method: "POST" })
    ),

  updateQuestion: (
    id: string,
    qid: string,
    patch: { answer?: string; done?: boolean }
  ) =>
    json<{ question: Question; progress: Progress }>(
      fetch(`/api/assignments/${id}/questions/${qid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    ),

  getSettings: () => json<{ settings: Settings }>(fetch("/api/settings")),

  saveSettings: (patch: { studentEmail?: string; notifyEnabled?: boolean }) =>
    json<{ settings: Settings }>(
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    ),

  sendTestReminder: () =>
    json<{ sent: boolean; count: number }>(
      fetch("/api/notify/test", { method: "POST" })
    ),
};
