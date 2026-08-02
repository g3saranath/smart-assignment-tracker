// Document ingestion: take an uploaded file (pdf / docx / txt / md) and
// convert it to markdown text the agent can read and search over.

import mammoth from "mammoth";
// pdf-parse ships as CommonJS; import the implementation file directly to
// avoid its index.js debug harness that reads a test file on import.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface IngestResult {
  markdown: string;
}

function textToMarkdown(text: string): string {
  // Normalize whitespace and collapse huge blank runs so the doc reads cleanly.
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<IngestResult> {
  const lower = filename.toLowerCase();

  // PDF
  if (mimetype === "application/pdf" || lower.endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return { markdown: textToMarkdown(data.text) };
  }

  // DOCX (Word)
  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    // convertToMarkdown preserves headings/lists as real markdown.
    const result = await mammoth.convertToMarkdown({ buffer });
    return { markdown: textToMarkdown(result.value) };
  }

  // Plain text / markdown
  if (
    mimetype.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return { markdown: textToMarkdown(buffer.toString("utf8")) };
  }

  throw new Error(
    `Unsupported file type: ${filename} (${mimetype}). Upload a PDF, DOCX, TXT, or MD file.`
  );
}
