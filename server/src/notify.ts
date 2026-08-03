// Email notifications for pending assignments. Uses nodemailer with SMTP
// credentials from .env. A lightweight scheduler checks periodically and
// emails the student a progress summary of what's still pending.

import nodemailer from "nodemailer";
import { getAssignments, getSettings, saveSettings } from "./store.js";
import { computeProgress, pendingAssignments, daysUntil } from "./progress.js";

function makeTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const missing = [
    !host && "SMTP_HOST",
    !user && "SMTP_USER",
    !pass && "SMTP_PASS",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Email is not configured. Missing in .env: ${missing.join(", ")}. ` +
        `For Gmail, set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER to your ` +
        `Gmail address, SMTP_PASS to a Google App Password (not your normal password), ` +
        `and SMTP_FROM to your Gmail address. Then restart the app.`
    );
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildSummaryHtml(): { html: string; text: string; count: number } {
  const pending = pendingAssignments(getAssignments());
  if (pending.length === 0) {
    const msg = "🎉 You're all caught up — no pending assignments!";
    return { html: `<p>${msg}</p>`, text: msg, count: 0 };
  }

  const rows = pending
    .map((a) => {
      const p = computeProgress(a);
      const d = daysUntil(a.dueDate);
      const due =
        d === null
          ? "no due date"
          : d < 0
            ? `${Math.abs(d)} day(s) overdue`
            : d === 0
              ? "due today!"
              : `due in ${d} day(s)`;
      return `<tr>
        <td style="padding:6px 12px;"><b>${a.title}</b><br><small>${a.course}</small></td>
        <td style="padding:6px 12px;">${p.completed}/${p.total} done<br>
          <small>${p.remaining} left · ${p.percent}%</small></td>
        <td style="padding:6px 12px;">${due}</td>
      </tr>`;
    })
    .join("");

  const html = `
    <h2>📚 Assignment reminder</h2>
    <p>You have <b>${pending.length}</b> pending assignment(s):</p>
    <table style="border-collapse:collapse;border:1px solid #ddd;">
      <tr style="background:#f4f4f4;">
        <th style="padding:6px 12px;text-align:left;">Assignment</th>
        <th style="padding:6px 12px;text-align:left;">Progress</th>
        <th style="padding:6px 12px;text-align:left;">Deadline</th>
      </tr>
      ${rows}
    </table>
    <p style="color:#666;">Keep going — you've got this! 💪</p>`;

  const text = pending
    .map((a) => {
      const p = computeProgress(a);
      return `${a.title} (${a.course}): ${p.completed}/${p.total} done, ${p.remaining} left`;
    })
    .join("\n");

  return { html, text, count: pending.length };
}

/** Send the pending-assignment summary email now. Returns how many were pending. */
export async function sendReminderNow(): Promise<{ sent: boolean; count: number }> {
  const settings = getSettings();
  if (!settings.studentEmail) {
    throw new Error("No student email set. Save it in Settings first.");
  }
  const { html, text, count } = buildSummaryHtml();
  const transport = makeTransport();
  // Verify the SMTP connection and credentials up front so failures produce a
  // clear error (for example, a wrong App Password) instead of a vague timeout.
  try {
    await transport.verify();
  } catch (err) {
    throw new Error(
      `Could not connect to the email server. Check SMTP_HOST, SMTP_PORT, and your ` +
        `credentials in .env. For Gmail, SMTP_PASS must be a Google App Password. ` +
        `Details: ${(err as Error).message}`
    );
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: settings.studentEmail,
    subject:
      count === 0
        ? "All assignments complete"
        : `${count} pending assignment(s): progress update`,
    text,
    html,
  });
  saveSettings({ ...settings, lastNotifiedAt: new Date().toISOString() });
  return { sent: true, count };
}

/**
 * Start a periodic scheduler. Every `intervalMs` it checks whether notifications
 * are enabled and, if enough time has passed, emails the student.
 */
export function startScheduler(intervalMs = 60 * 60 * 1000): void {
  const MIN_GAP_MS = 12 * 60 * 60 * 1000; // don't email more than every 12h
  setInterval(async () => {
    try {
      const settings = getSettings();
      if (!settings.notifyEnabled || !settings.studentEmail) return;
      const last = settings.lastNotifiedAt
        ? new Date(settings.lastNotifiedAt).getTime()
        : 0;
      if (Date.now() - last < MIN_GAP_MS) return;
      if (pendingAssignments(getAssignments()).length === 0) return;
      await sendReminderNow();
      console.log("[scheduler] reminder email sent");
    } catch (err) {
      console.error("[scheduler] failed:", (err as Error).message);
    }
  }, intervalMs).unref?.();
}
