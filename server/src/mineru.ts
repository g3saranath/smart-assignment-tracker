// MinerU client — sends a document to a self-hosted `mineru-api` service and
// returns clean, reading-order markdown plus the figures MinerU extracted
// (with OCR for scanned/image PDFs). Run the service alongside this server:
//
//   pip install -U "mineru[all]"
//   mineru-api --host 127.0.0.1 --port 8000
//
// then set MINERU_API_URL=http://127.0.0.1:8000 in .env.
//
// Endpoint contract (POST /file_parse, response_format_zip=false):
//   { backend, version, results: { "<stem>": {
//       md_content:   "<markdown>",
//       content_list: "<JSON string of reading-order blocks>",
//       images:       { "<basename>": "data:<mime>;base64,<...>" }
//   } } }

import type { RawImage } from "./assets.js";

export interface MineruResult {
  markdown: string;
  images: RawImage[];
}

const apiUrl = () => (process.env.MINERU_API_URL || "").replace(/\/+$/, "");
const backend = () => process.env.MINERU_BACKEND || "pipeline";
const lang = () => (process.env.MINERU_LANG || "").trim();
const timeoutMs = () => Number(process.env.MINERU_TIMEOUT_MS || 300_000);
const maxRetries = () => Number(process.env.MINERU_MAX_RETRIES || 2);

// Upper bound on figures kept when there's no content list to pick real
// figures from, so a pathological doc can't attach hundreds of crops.
const MAX_FALLBACK_IMAGES = 24;

/** True when a MinerU service URL is configured. */
export function isMineruConfigured(): boolean {
  return apiUrl().length > 0;
}

interface ContentBlock {
  type?: string;
  img_path?: string;
  image_caption?: string[] | string;
  page_idx?: number;
}

interface ParseResult {
  md_content?: string | null;
  content_list?: string | null;
  images?: Record<string, string> | null;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function toText(v: string[] | string | undefined): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(" ").trim();
  return (v ?? "").trim();
}

/** Decode a `data:<mime>;base64,<...>` URL into bytes + mime type. */
function decodeDataUrl(dataUrl: string): { data: Buffer; mimeType: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], data: Buffer.from(m[2], "base64") };
}

/**
 * Select the genuine figures from a parse result. We drive selection from the
 * reading-order `content_list` (type === "image") so we attach real figures
 * with their captions/pages, not table/formula crops. Falls back to attaching
 * every returned image when no content list is available.
 */
function collectImages(result: ParseResult): RawImage[] {
  const imageMap = result.images ?? {};
  const entries = Object.entries(imageMap);
  if (entries.length === 0) return [];

  let blocks: ContentBlock[] = [];
  if (result.content_list) {
    try {
      blocks = JSON.parse(result.content_list) as ContentBlock[];
    } catch {
      blocks = [];
    }
  }

  const figureBlocks = blocks.filter(
    (b) => b.type === "image" && typeof b.img_path === "string"
  );

  const pick = (dataUrl: string, caption: string, page: number): RawImage | null => {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) return null;
    return { data: decoded.data, mimeType: decoded.mimeType, caption, page };
  };

  if (figureBlocks.length > 0) {
    const out: RawImage[] = [];
    for (const b of figureBlocks) {
      const dataUrl = imageMap[basename(b.img_path!)];
      if (!dataUrl) continue;
      const img = pick(dataUrl, toText(b.image_caption), b.page_idx ?? -1);
      if (img) out.push(img);
    }
    if (out.length > 0) return out;
  }

  // Fallback: no usable content list, attach everything MinerU returned
  // (bounded, since this can include table/formula crops).
  return entries
    .slice(0, MAX_FALLBACK_IMAGES)
    .map(([, dataUrl]) => pick(dataUrl, "", -1))
    .filter((x): x is RawImage => x !== null);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Errors worth retrying (network blips, service still starting, 5xx). */
function transient(message: string): Error {
  return Object.assign(new Error(message), { transient: true });
}
function isTransient(err: unknown): boolean {
  return !!(err && typeof err === "object" && (err as { transient?: boolean }).transient);
}

/** One MinerU parse attempt. Tags retryable failures as `transient`. */
async function parseOnce(
  base: string,
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<MineruResult> {
  const form = new FormData();
  // Copy into a fresh Uint8Array so the Blob is backed by a plain ArrayBuffer.
  form.append("files", new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
  form.append("backend", backend());
  // lang_list is optional; recent MinerU builds restrict the accepted codes and
  // route Latin languages through the default model, so only send when set.
  if (lang()) form.append("lang_list", lang());
  form.append("parse_method", "auto");
  form.append("formula_enable", "true");
  form.append("table_enable", "true");
  form.append("return_md", "true");
  form.append("return_content_list", "true");
  form.append("return_images", "true");
  form.append("response_format_zip", "false");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let res: Response;
  try {
    res = await fetch(`${base}/file_parse`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    // A timeout won't get better by retrying the same slow parse.
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `MinerU timed out after ${Math.round(timeoutMs() / 1000)}s parsing "${filename}". ` +
          `Large scans on the CPU 'pipeline' backend are slow; raise MINERU_TIMEOUT_MS or use a GPU.`
      );
    }
    // Network-level failure (service starting, transient DNS/socket): retry.
    throw transient(
      `Could not reach MinerU at ${base} (${(err as Error).message}). Is 'mineru-api' running?`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `MinerU /file_parse failed (${res.status}): ${body.slice(0, 500)}`;
    // 5xx is usually transient; 4xx/409 (bad request / deterministic parse failure) is not.
    throw res.status >= 500 ? transient(msg) : new Error(msg);
  }

  const json = (await res.json()) as { results?: Record<string, ParseResult> };
  const result = Object.values(json.results ?? {})[0];
  if (!result || result.md_content == null) {
    throw new Error(`MinerU returned no content for "${filename}".`);
  }

  return { markdown: result.md_content, images: collectImages(result) };
}

/** Parse a document through the MinerU service, retrying transient failures. */
export async function parseWithMineru(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<MineruResult> {
  const base = apiUrl();
  if (!base) throw new Error("MINERU_API_URL is not set.");

  const retries = maxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await parseOnce(base, buffer, filename, mimetype);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isTransient(err)) throw err;
      const waitMs = 2 ** attempt * 1000;
      console.warn(
        `[mineru] ${(err as Error).message}; retry ${attempt + 1}/${retries} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}
