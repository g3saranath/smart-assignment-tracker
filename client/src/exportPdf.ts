// PDF export of assignments + their Q&A, built client-side with jsPDF.
// Two entry points:
//   exportAllToPdf()        -> download one combined PDF of everything
//   buildPdfsForAssignments(ids) -> one separate PDF per selected assignment
//                              (used by the "Email PDF" flow as attachments)
//
// Uses jsPDF's built-in "helvetica" font, which only supports Latin-1, so
// non-Latin-1 characters (emoji, CJK, most math symbols) are stripped.

import { jsPDF } from "jspdf";
import { api } from "./api.js";
import type { Assignment, Progress } from "./api.js";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - MARGIN;

interface LoadedItem {
  assignment: Assignment;
  progress: Progress;
}

export interface BuiltPdf {
  blob: Blob;
  filename: string;
}

function clean(text: string): string {
  return text.replace(/[^\u0020-\u00FF\n]/g, "");
}

/** Filename-safe slug from an assignment title. */
function slugify(title: string): string {
  const slug = clean(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "assignment";
}

/** Fetch full assignment data for the given ids (or all when omitted). */
async function loadItems(ids?: string[]): Promise<LoadedItem[]> {
  const { assignments: summaries } = await api.listAssignments();
  const wanted =
    ids && ids.length > 0
      ? summaries.filter((s) => ids.includes(s.id))
      : summaries;
  return Promise.all(wanted.map((s) => api.getAssignment(s.id)));
}

/** Render a complete document for the given items and return it unsaved. */
function renderPdf(items: LoadedItem[]): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const newPageIfNeeded = (needed: number): number => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      return MARGIN;
    }
    return y;
  };

  // Draws pre-wrapped lines one at a time, breaking pages between lines so a
  // block taller than a page can't overflow off the bottom.
  const writeLines = (lines: string[], x: number, lineH: number): void => {
    for (const line of lines) {
      y = newPageIfNeeded(lineH);
      doc.text(line, x, y);
      y += lineH;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(
    items.length === 1 ? clean(items[0].assignment.title) : "Smart Assignment Tracker",
    MARGIN,
    y
  );
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Generated ${new Date().toLocaleString()}`, MARGIN, y);
  y += 5;

  const totalQ = items.reduce((n, i) => n + i.progress.total, 0);
  const doneQ = items.reduce((n, i) => n + i.progress.completed, 0);
  doc.text(
    `${items.length} assignment(s) · ${doneQ}/${totalQ} questions completed`,
    MARGIN,
    y
  );
  y += 7;
  doc.setTextColor(0);

  for (const { assignment: a, progress: p } of items) {
    if (items.length > 1) {
      y = newPageIfNeeded(26);
      doc.setDrawColor(220);
      doc.line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(clean(a.title), MARGIN, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    const due = a.dueDate ? ` · due ${a.dueDate}` : "";
    doc.text(clean(`${a.course}${due} · ${p.completed}/${p.total} done (${p.percent}%)`), MARGIN, y);
    y += 5;
    doc.setTextColor(0);

    if (a.questions.length === 0) {
      doc.setFontSize(10);
      doc.text("No questions extracted.", MARGIN, y);
      y += 6;
      continue;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    for (const q of a.questions) {
      const mark = q.done ? "[done] " : "";
      const prompt = doc.splitTextToSize(clean(`${mark}${q.prompt}`), CONTENT_W);
      writeLines(prompt, MARGIN, 5);
      y += 1.5;

      if (q.answer) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        const answer = doc.splitTextToSize(clean(q.answer), CONTENT_W - 6);
        writeLines(answer, MARGIN + 6, 4);
        y += 1;

        if (q.sources.length > 0) {
          doc.setFontSize(8);
          doc.setTextColor(90);
          const sources = doc.splitTextToSize(
            "Sources: " + q.sources.join("  |  "),
            CONTENT_W - 6
          );
          writeLines(sources, MARGIN + 6, 3.5);
          y += 1;
          doc.setTextColor(0);
        }
      }

      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
    }
    y += 6;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 8, { align: "center" });
  }

  return doc;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Build the whole-tracker combined PDF and save it to downloads. */
export async function exportAllToPdf(): Promise<number> {
  const items = await loadItems();
  // Nothing to export — bail out before creating/saving an empty PDF.
  if (items.length === 0) return 0;
  const filename = `assignments-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBlob(renderPdf(items).output("blob"), filename);
  return items.length;
}

/**
 * Build one separate PDF per selected assignment (ready to attach to an email).
 * Filenames come from each assignment title, e.g. `physics-hw-5-2026-08-22.pdf`.
 */
export async function buildPdfsForAssignments(
  ids: string[]
): Promise<BuiltPdf[]> {
  const items = await loadItems(ids);
  if (items.length === 0) return [];
  const date = new Date().toISOString().slice(0, 10);
  return items.map(({ assignment, progress }) => ({
    blob: renderPdf([{ assignment, progress }]).output("blob"),
    filename: `${slugify(assignment.title)}-${date}.pdf`,
  }));
}
