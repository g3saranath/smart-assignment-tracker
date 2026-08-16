// One-click PDF export of all assignments + their Q&A.
// Uses jsPDF's built-in "helvetica" font, which only supports Latin-1, so
// non-Latin-1 characters (emoji, CJK, most math symbols) are stripped.

import { jsPDF } from "jspdf";
import { api } from "./api.js";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - MARGIN;

function clean(text: string): string {
  return text.replace(/[^\u0020-\u00FF\n]/g, "");
}

export async function exportAllToPdf(): Promise<number> {
  const { assignments: summaries } = await api.listAssignments();
  const items = await Promise.all(
    summaries.map((s) => api.getAssignment(s.id))
  );

  // Nothing to export — bail out before creating/saving an empty PDF.
  if (items.length === 0) return 0;

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
  doc.text("Smart Assignment Tracker", MARGIN, y);
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
    y = newPageIfNeeded(26);
    doc.setDrawColor(220);
    doc.line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3);

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

  doc.save(`assignments-${new Date().toISOString().slice(0, 10)}.pdf`);
  return items.length;
}
