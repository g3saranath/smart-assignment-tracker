// Document ingestion: take an uploaded file and convert it to markdown text the
// agent can read and search over, plus any figures extracted from it.
//
// Routing:
//   - PDFs and images  -> MinerU service (OCR + figure extraction) when
//     MINERU_API_URL is set. PDFs fall back to text-only pdf-parse when it
//     isn't, so the app still runs without MinerU installed.
//   - DOCX             -> mammoth (markdown, no OCR needed).
//   - TXT / MD         -> passed through as-is.

import mammoth from "mammoth";
// pdf-parse ships as CommonJS; import the implementation file directly to
// avoid its index.js debug harness that reads a test file on import.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { RawImage } from "./assets.js";
import { isMineruConfigured, parseWithMineru } from "./mineru.js";

export interface IngestResult {
  markdown: string;
  images: RawImage[];
}

function textToMarkdown(text: string): string {
  // Normalize whitespace and collapse huge blank runs so the doc reads cleanly.
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isImage(mimetype: string, lower: string): boolean {
  return (
    mimetype.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(lower)
  );
}

export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<IngestResult> {
  const lower = filename.toLowerCase();
  const isPdf = mimetype === "application/pdf" || lower.endsWith(".pdf");
  const image = isImage(mimetype, lower);

  // PDFs and images -> MinerU (OCR + figures) when configured.
  if ((isPdf || image) && isMineruConfigured()) {
    const { markdown, images } = await parseWithMineru(buffer, filename, mimetype);
    return { markdown: textToMarkdown(markdown), images };
  }

  // PDF without MinerU -> text layer only (no OCR, no figures).
  if (isPdf) {
    const data = await pdfParse(buffer);
    const markdown = textToMarkdown(data.text);
    // A scanned/image-only PDF has no text layer, so pdf-parse yields ~nothing.
    // Fail loudly with guidance instead of silently creating an empty assignment.
    if (markdown.replace(/\s/g, "").length < 10) {
      throw new Error(
        `"${filename}" has no extractable text (it looks scanned/image-only). ` +
          `Configure MINERU_API_URL and run 'mineru-api' to OCR it.`
      );
    }
    return { markdown, images: [] };
  }

  // An image without MinerU can't be read at all — fail with guidance.
  if (image) {
    throw new Error(
      `Reading "${filename}" requires the MinerU OCR service. Set MINERU_API_URL in .env ` +
        `and run 'mineru-api', or upload a PDF/DOCX/TXT instead.`
    );
  }

  // DOCX (Word)
  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    // convertToMarkdown preserves headings/lists as real markdown.
    const result = await mammoth.convertToMarkdown({ buffer });
    return { markdown: textToMarkdown(result.value), images: [] };
  }

  // Plain text / markdown
  if (
    mimetype.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    return { markdown: textToMarkdown(buffer.toString("utf8")), images: [] };
  }

  throw new Error(
    `Unsupported file type: ${filename} (${mimetype}). Upload a PDF, image, DOCX, TXT, or MD file.`
  );
}
