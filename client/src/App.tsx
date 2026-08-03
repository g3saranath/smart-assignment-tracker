import { useEffect, useState } from "react";
import Markdown from "./Markdown.js";
import {
  api,
  type AssignmentSummary,
  type Assignment,
  type Progress,
  type Settings,
} from "./api.js";

type Theme = "light" | "dark";

function statusClass(status: Progress["status"]): string {
  switch (status) {
    case "overdue":
      return "status-overdue";
    case "due-today":
    case "due-soon":
      return "status-warn";
    case "done":
      return "status-done";
    default:
      return "status-ok";
  }
}

function dueLabel(p: Progress): string {
  if (p.status === "done") return "Complete";
  if (p.daysLeft === null) return "No due date";
  if (p.daysLeft < 0) return `${Math.abs(p.daysLeft)}d overdue`;
  if (p.daysLeft === 0) return "Due today";
  return `Due in ${p.daysLeft}d`;
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function ProgressBar({ p, showLabel = true }: { p: Progress; showLabel?: boolean }) {
  return (
    <div className="progress">
      <div className="progress-track">
        <div
          className={`progress-fill ${statusClass(p.status)}`}
          style={{ width: `${p.percent}%` }}
        />
      </div>
      {showLabel && (
        <div className="progress-meta">
          <span>{p.percent}%</span>
          <span className="muted">
            {p.completed}/{p.total} done, {p.remaining} left
          </span>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-chip">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function App() {
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [selectedProgress, setSelectedProgress] = useState<Progress | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [solvingId, setSolvingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function refresh() {
    const { assignments } = await api.listAssignments();
    setAssignments(assignments);
  }

  useEffect(() => {
    refresh().catch((e) => setMsg(e.message));
    api.getSettings().then((r) => setSettings(r.settings)).catch(() => {});
  }, []);

  async function openAssignment(id: string) {
    setMsg("");
    const { assignment, progress } = await api.getAssignment(id);
    setSelected(assignment);
    setSelectedProgress(progress);
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    if (!(form.get("document") as File)?.size) {
      setMsg("Please choose a document to upload.");
      return;
    }
    setLoading(true);
    setMsg("Ingesting document and extracting questions.");
    try {
      const { assignment } = await api.createAssignment(form);
      formEl.reset();
      await refresh();
      await openAssignment(assignment.id);
      setMsg(`Added "${assignment.title}" with ${assignment.questions.length} question(s).`);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function solve(qid: string) {
    if (!selected) return;
    setSolvingId(qid);
    setMsg("Agent is solving. Reading your document and searching the web.");
    try {
      const { question, progress, usedWebSearch } = await api.solveQuestion(
        selected.id,
        qid
      );
      setSelected({
        ...selected,
        questions: selected.questions.map((q) => (q.id === qid ? question : q)),
      });
      setSelectedProgress(progress);
      setMsg(
        usedWebSearch
          ? "Answer generated using web search."
          : "Answer generated from the document. Web search was rate-limited, so it was skipped this time."
      );
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSolvingId(null);
    }
  }

  async function toggleDone(qid: string, done: boolean) {
    if (!selected) return;
    const { question, progress } = await api.updateQuestion(selected.id, qid, { done });
    setSelected({
      ...selected,
      questions: selected.questions.map((q) => (q.id === qid ? question : q)),
    });
    setSelectedProgress(progress);
    await refresh();
  }

  async function removeAssignment(id: string) {
    await api.deleteAssignment(id);
    if (selected?.id === id) {
      setSelected(null);
      setSelectedProgress(null);
    }
    await refresh();
  }

  async function saveSettings(patch: { studentEmail?: string; notifyEnabled?: boolean }) {
    const { settings } = await api.saveSettings(patch);
    setSettings(settings);
    setMsg("Settings saved.");
  }

  async function testEmail() {
    setMsg("Sending test reminder email.");
    try {
      const r = await api.sendTestReminder();
      setMsg(`Email sent. ${r.count} pending assignment(s) reported.`);
      const s = await api.getSettings();
      setSettings(s.settings);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const totalOpen = assignments.filter((a) => a.progress.status !== "done").length;
  const totalDone = assignments.filter((a) => a.progress.status === "done").length;

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <div className="brand-mark">SA</div>
          <div>
            <h1>Smart Assignment Tracker</h1>
            <p className="tagline">
              Upload a document. The agent extracts questions, solves them with
              web search, and tracks your progress.
            </p>
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </header>

      {msg && (
        <div className="banner">
          <span>{msg}</span>
          <button className="banner-close" onClick={() => setMsg("")} aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      )}

      <div className="layout">
        <aside className="sidebar">
          <section className="card upload-card">
            <h2 className="card-title">New assignment</h2>
            <form onSubmit={handleUpload} className="stack">
              <label className="field">
                <span className="field-label">Title</span>
                <input name="title" placeholder="Optional" />
              </label>
              <label className="field">
                <span className="field-label">Course</span>
                <input name="course" placeholder="Optional" />
              </label>
              <label className="field">
                <span className="field-label">Due date</span>
                <input name="dueDate" type="date" />
              </label>
              <label className="field">
                <span className="field-label">Document (PDF, DOCX, TXT, MD)</span>
                <input
                  name="document"
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  className="file-input"
                  required
                />
              </label>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Working" : "Upload and extract"}
              </button>
            </form>
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Assignments</h2>
              <div className="mini-stats">
                <span className="chip-count">{totalOpen} open</span>
                <span className="chip-count muted">{totalDone} done</span>
              </div>
            </div>
            {assignments.length === 0 && (
              <p className="muted small">No assignments yet.</p>
            )}
            <div className="list">
              {assignments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`list-item ${selected?.id === a.id ? "active" : ""}`}
                  onClick={() => openAssignment(a.id)}
                >
                  <div className="avatar">{initials(a.title)}</div>
                  <div className="list-item-body">
                    <div className="list-item-head">
                      <strong className="ellipsis">{a.title}</strong>
                      <span className={`pill ${statusClass(a.progress.status)}`}>
                        {dueLabel(a.progress)}
                      </span>
                    </div>
                    <small className="muted ellipsis">{a.course}</small>
                    <ProgressBar p={a.progress} showLabel={false} />
                    <div className="list-item-foot">
                      <span className="muted small">
                        {a.progress.completed}/{a.progress.total} done
                      </span>
                      <span
                        className="link-danger"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAssignment(a.id);
                        }}
                      >
                        Delete
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {settings && (
            <section className="card">
              <h2 className="card-title">Notifications</h2>
              <label className="field">
                <span className="field-label">Student email</span>
                <input
                  type="email"
                  defaultValue={settings.studentEmail}
                  placeholder="student@example.com"
                  onBlur={(e) => saveSettings({ studentEmail: e.target.value })}
                />
              </label>
              <label className="switch-row">
                <span>Email me reminders for pending assignments</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={settings.notifyEnabled}
                  onChange={(e) => saveSettings({ notifyEnabled: e.target.checked })}
                />
              </label>
              <div className="notify-info">
                <p className="muted small">
                  {settings.notifyEnabled
                    ? "Reminders are on. While the app is running, it checks hourly and emails a summary of pending assignments at most once every 12 hours."
                    : "Reminders are off. Turn this on to get an emailed summary of pending assignments at most once every 12 hours (checked hourly while the app runs)."}
                </p>
                <p className="muted small">
                  Last reminder sent:{" "}
                  {settings.lastNotifiedAt
                    ? new Date(settings.lastNotifiedAt).toLocaleString()
                    : "never"}
                </p>
              </div>
              <button className="btn-ghost" onClick={testEmail}>
                Send test reminder now
              </button>
            </section>
          )}
        </aside>

        <main className="content">
          {!selected && (
            <div className="empty card">
              <div className="empty-mark">SA</div>
              <h2>Select or upload an assignment</h2>
              <p className="muted">
                Choose an assignment on the left, or upload a new document to get
                started. The agent will read it and pull out the questions for you.
              </p>
            </div>
          )}

          {selected && selectedProgress && (
            <section className="card detail">
              <div className="detail-head">
                <div className="detail-title">
                  <div className="avatar large">{initials(selected.title)}</div>
                  <div>
                    <h2>{selected.title}</h2>
                    <p className="muted">
                      {selected.course}
                      {selected.dueDate ? ` · due ${selected.dueDate}` : ""}
                    </p>
                  </div>
                </div>
                <span className={`pill big ${statusClass(selectedProgress.status)}`}>
                  {dueLabel(selectedProgress)}
                </span>
              </div>

              <div className="stat-row">
                <StatChip label="Total" value={selectedProgress.total} />
                <StatChip label="Completed" value={selectedProgress.completed} />
                <StatChip label="Remaining" value={selectedProgress.remaining} />
                <StatChip
                  label="Days left"
                  value={
                    selectedProgress.daysLeft === null
                      ? "-"
                      : selectedProgress.daysLeft
                  }
                />
              </div>

              <ProgressBar p={selectedProgress} />

              <h3 className="section-title">
                Questions ({selectedProgress.completed}/{selectedProgress.total} completed)
              </h3>
              {selected.questions.length === 0 && (
                <p className="muted">
                  The agent did not detect distinct questions in this document.
                </p>
              )}

              <ol className="questions">
                {selected.questions.map((q, i) => (
                  <li key={q.id} className={q.done ? "q done" : "q"}>
                    <div className="q-head">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={q.done}
                          onChange={(e) => toggleDone(q.id, e.target.checked)}
                        />
                        <span className="checkmark" />
                      </label>
                      <div className="q-body">
                        <span className="q-index">Q{i + 1}</span>
                        <span className="q-prompt">{q.prompt}</span>
                      </div>
                    </div>

                    <div className="q-actions">
                      <button
                        className="btn-ghost"
                        onClick={() => solve(q.id)}
                        disabled={solvingId === q.id}
                      >
                        {solvingId === q.id
                          ? "Solving"
                          : q.answer
                            ? "Re-solve"
                            : "Solve with agent"}
                      </button>
                    </div>

                    {solvingId === q.id && !q.answer && (
                      <div className="answer skeleton">
                        <div className="sk-line" />
                        <div className="sk-line short" />
                        <div className="sk-line" />
                      </div>
                    )}

                    {q.answer && (
                      <div className="answer">
                        <Markdown>{q.answer}</Markdown>
                        {q.sources.length > 0 && (
                          <div className="sources">
                            <strong>Sources</strong>
                            <ul>
                              {q.sources.map((s, idx) => (
                                <li key={idx}>
                                  <a href={s} target="_blank" rel="noreferrer">
                                    {s}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
