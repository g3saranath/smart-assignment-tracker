import { useEffect, useState } from "react";
import {
  api,
  type AssignmentSummary,
  type Assignment,
  type Progress,
  type Settings,
} from "./api.js";

function statusColor(status: Progress["status"]): string {
  switch (status) {
    case "overdue":
      return "#e5484d";
    case "due-today":
    case "due-soon":
      return "#f5a623";
    case "done":
      return "#30a46c";
    default:
      return "#5b6bff";
  }
}

function dueLabel(p: Progress): string {
  if (p.status === "done") return "Complete";
  if (p.daysLeft === null) return "No due date";
  if (p.daysLeft < 0) return `${Math.abs(p.daysLeft)}d overdue`;
  if (p.daysLeft === 0) return "Due today";
  return `Due in ${p.daysLeft}d`;
}

function ProgressBar({ p }: { p: Progress }) {
  return (
    <div className="progress">
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${p.percent}%`, background: statusColor(p.status) }}
        />
      </div>
      <span className="progress-label">
        {p.completed}/{p.total} done · {p.remaining} left
      </span>
    </div>
  );
}

export default function App() {
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [selectedProgress, setSelectedProgress] = useState<Progress | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

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
    const form = new FormData(e.currentTarget);
    if (!(form.get("document") as File)?.size) {
      setMsg("Please choose a document to upload.");
      return;
    }
    setLoading(true);
    setMsg("Ingesting document and extracting questions…");
    try {
      const { assignment } = await api.createAssignment(form);
      (e.target as HTMLFormElement).reset();
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
    setMsg("🤖 Agent is solving (reading your doc + searching the web)…");
    try {
      const { question, progress } = await api.solveQuestion(selected.id, qid);
      setSelected({
        ...selected,
        questions: selected.questions.map((q) => (q.id === qid ? question : q)),
      });
      setSelectedProgress(progress);
      setMsg("Done — answer generated.");
    } catch (err) {
      setMsg((err as Error).message);
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
    setMsg("Sending test reminder email…");
    try {
      const r = await api.sendTestReminder();
      setMsg(`Email sent — ${r.count} pending assignment(s) reported.`);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>📚 Smart Assignment Tracker</h1>
        <p>Upload a doc → the agent extracts questions, solves them with web search, and tracks your progress.</p>
      </header>

      {msg && <div className="banner">{msg}</div>}

      <div className="layout">
        {/* Left column: upload + list + settings */}
        <aside>
          <section className="card">
            <h2>Add assignment</h2>
            <form onSubmit={handleUpload}>
              <input name="title" placeholder="Title (optional)" />
              <input name="course" placeholder="Course (optional)" />
              <label className="field-label">Due date</label>
              <input name="dueDate" type="date" />
              <label className="field-label">Document (PDF, DOCX, TXT, MD)</label>
              <input name="document" type="file" accept=".pdf,.docx,.txt,.md" required />
              <button type="submit" disabled={loading}>
                {loading ? "Working…" : "🤖 Upload & extract"}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Assignments</h2>
            {assignments.length === 0 && <p className="muted">None yet.</p>}
            {assignments.map((a) => (
              <div
                key={a.id}
                className={`list-item ${selected?.id === a.id ? "active" : ""}`}
                onClick={() => openAssignment(a.id)}
              >
                <div className="list-item-head">
                  <strong>{a.title}</strong>
                  <span
                    className="pill"
                    style={{ background: statusColor(a.progress.status) }}
                  >
                    {dueLabel(a.progress)}
                  </span>
                </div>
                <small className="muted">{a.course}</small>
                <ProgressBar p={a.progress} />
                <button
                  className="link-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAssignment(a.id);
                  }}
                >
                  delete
                </button>
              </div>
            ))}
          </section>

          {settings && (
            <section className="card">
              <h2>🔔 Notifications</h2>
              <label className="field-label">Student email</label>
              <input
                type="email"
                defaultValue={settings.studentEmail}
                placeholder="student@example.com"
                onBlur={(e) => saveSettings({ studentEmail: e.target.value })}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.notifyEnabled}
                  onChange={(e) => saveSettings({ notifyEnabled: e.target.checked })}
                />
                Email me reminders for pending assignments
              </label>
              <button className="secondary" onClick={testEmail}>
                Send test reminder now
              </button>
            </section>
          )}
        </aside>

        {/* Right column: selected assignment detail */}
        <main>
          {!selected && <div className="empty">Select or upload an assignment to begin.</div>}
          {selected && selectedProgress && (
            <section className="card">
              <div className="detail-head">
                <div>
                  <h2>{selected.title}</h2>
                  <p className="muted">
                    {selected.course}
                    {selected.dueDate ? ` · due ${selected.dueDate}` : ""}
                  </p>
                </div>
                <span
                  className="pill big"
                  style={{ background: statusColor(selectedProgress.status) }}
                >
                  {dueLabel(selectedProgress)}
                </span>
              </div>
              <ProgressBar p={selectedProgress} />

              <h3>Questions ({selectedProgress.completed}/{selectedProgress.total} completed)</h3>
              {selected.questions.length === 0 && (
                <p className="muted">
                  The agent didn't detect distinct questions in this document.
                </p>
              )}
              <ol className="questions">
                {selected.questions.map((q) => (
                  <li key={q.id} className={q.done ? "q done" : "q"}>
                    <div className="q-head">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={q.done}
                          onChange={(e) => toggleDone(q.id, e.target.checked)}
                        />
                        <span className="q-prompt">{q.prompt}</span>
                      </label>
                    </div>
                    <div className="q-actions">
                      <button className="secondary" onClick={() => solve(q.id)}>
                        {q.answer ? "🔄 Re-solve" : "🤖 Solve with agent"}
                      </button>
                    </div>
                    {q.answer && (
                      <div className="answer">
                        <pre>{q.answer}</pre>
                        {q.sources.length > 0 && (
                          <div className="sources">
                            <strong>Sources:</strong>
                            <ul>
                              {q.sources.map((s, i) => (
                                <li key={i}>
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
