// The agentic core. Two jobs:
//   1. extractQuestions() — read the ingested doc markdown and pull out the
//      individual questions/tasks the student must complete.
//   2. solveQuestion()   — answer one question using the document as context
//      PLUS live Google Search grounding, returning the answer + source URLs.

import { GoogleGenAI, Type } from "@google/genai";
import type { Content, Part } from "@google/genai";
import type { AssignmentImage, Question } from "./types.js";
import { readImageBytes } from "./assets.js";
import { correlateQuestionContext, imageIdsInContext } from "./questionContext.js";

// Model is configurable via .env so you can switch tiers/models without code
// changes (e.g. GEMINI_MODEL=gemini-3.5-flash-lite). These are read at call time
// (not import time) because ES module imports run before dotenv loads .env.
const model = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const maxRetries = () => Number(process.env.GEMINI_MAX_RETRIES || 3);
// How many document figures to attach to a single Gemini call, the per-image
// byte ceiling, and the cumulative byte budget across all attached figures.
// Keeps token cost and payload size bounded on figure-heavy docs.
const maxImages = () => Number(process.env.GEMINI_MAX_IMAGES || 6);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and add your free key."
    );
  }
  return new GoogleGenAI({ apiKey });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the server-suggested retry delay (seconds) out of a 429 error, if any. */
function retryDelaySeconds(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([\d.]+)s|retryDelay"?:\s*"?([\d.]+)s/i);
  const secs = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(secs) ? secs : null;
}

function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || /RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg);
}

/** Transient server-side unavailability (503) that is usually worth retrying. */
function isOverloaded(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("503") || /UNAVAILABLE|overloaded|high demand/i.test(msg);
}

/** True when the quota is a hard zero — retrying will never help. */
function isZeroQuota(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /limit:\s*0\b/.test(msg);
}

/**
 * Call Gemini with automatic retry/backoff on transient 429s. A `limit: 0`
 * quota fails fast with a clear, actionable message instead of looping.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const retries = maxRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) && !isOverloaded(err)) throw err;

      if (isZeroQuota(err)) {
        throw new Error(
          `Gemini quota is 0 for model "${model()}" on this API key — retrying won't help. ` +
            `This usually means the key's project has no free-tier access. Fix: create a NEW ` +
            `key via "Create API key in a new project" at https://aistudio.google.com/apikey, ` +
            `or set GEMINI_MODEL to a model your project can access, or enable billing. ` +
            `(Original error while ${label}.)`
        );
      }

      if (attempt === retries) break;
      // Respect the server's suggested delay; otherwise exponential backoff.
      const suggested = retryDelaySeconds(err);
      const waitMs = suggested != null ? suggested * 1000 + 500 : 2 ** attempt * 1000;
      console.warn(
        `[gemini] ${isOverloaded(err) ? "overloaded" : "rate-limited"} while ${label}; retry ${attempt + 1}/${retries} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }
  return t;
}

/**
 * Build a multimodal `contents` payload: the text prompt, a short manifest of
 * the attached figures (so the model can correlate them), then the figure
 * images themselves as inline data parts, in the same order as the manifest.
 */
async function buildContents(
  prompt: string,
  images: AssignmentImage[]
): Promise<Content[]> {
  const attached: Part[] = [];
  let manifest = "";
  let n = 0;
  let totalBytes = 0;

  for (const img of images.slice(0, maxImages())) {
    let bytes: Buffer;
    try {
      bytes = await readImageBytes(img.file);
    } catch {
      continue; // asset missing on disk, skip rather than fail the call
    }
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) continue;
    if (totalBytes + bytes.length > MAX_TOTAL_IMAGE_BYTES) break; // budget hit
    totalBytes += bytes.length;
    n += 1;
    const where = img.page >= 0 ? ` (page ${img.page + 1})` : "";
    const cap = img.caption ? `: ${img.caption}` : "";
    manifest += `\n- Figure ${n} [imageId: ${img.id}]${where}${cap}`;
    attached.push({
      inlineData: { mimeType: img.mimeType, data: bytes.toString("base64") },
    });
  }

  const text = attached.length
    ? `${prompt}\n\n${attached.length} figure(s) from the document are attached below, in order:${manifest}`
    : prompt;

  return [{ role: "user", parts: [{ text }, ...attached] }];
}

export interface ExtractedQuestion {
  prompt: string;
  context: string;
  imageIds: string[];
}

/** Read the document and extract questions with their local source context. */
export async function extractQuestions(
  docMarkdown: string,
  images: AssignmentImage[] = []
): Promise<ExtractedQuestion[]> {
  const ai = client();
  const prompt = `You are helping a student break an assignment into its individual questions.

Below is the assignment document (in markdown). Extract every distinct question,
problem, or task the student is asked to complete. Keep each question's full text.
If figures are attached, include any questions shown only inside those images.

Return ONLY a JSON array of objects with this exact shape:
[{"prompt":"the complete question","context":"the verbatim relevant source section","imageIds":["linked imageId"]}]

The context must contain only the text needed to answer that question, copied verbatim
from the document. Preserve any markdown image references in that relevant section so
the question can be linked to its figure. imageIds must contain only IDs from the attached
figure manifest that are directly relevant to this question; use [] when no figure is needed.
Do not include unrelated document sections or figures.
No markdown fences or commentary around the JSON.

Assignment document:
"""
${docMarkdown.slice(0, 30000)}
"""`;

  const contents = await buildContents(prompt, images);
  const res = await withRetry(
    () =>
      ai.models.generateContent({
        model: model(),
        contents: contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["prompt", "context", "imageIds"],
              properties: {
                prompt: { type: Type.STRING },
                context: { type: Type.STRING },
                imageIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
            },
          },
        },
      }),
    "extracting questions"
  );

  const text = stripFences(res.text ?? "[]");
  try {
    const arr = JSON.parse(text) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((item) => {
      if (typeof item === "string") {
        const correlated = correlateQuestionContext(item, docMarkdown, images);
        return [{ prompt: item, ...correlated }];
      }
      if (!item || typeof item !== "object") return [];
      const value = item as {
        prompt?: unknown;
        context?: unknown;
        imageIds?: unknown;
      };
      if (typeof value.prompt !== "string") return [];
      const fallback = correlateQuestionContext(value.prompt, docMarkdown, images);
      let context =
        typeof value.context === "string" && value.context.trim()
          ? value.context.trim().slice(0, 8000)
          : fallback.context;
      const validImageIds = new Set(images.map((image) => image.id));
      const explicitImageIds = Array.isArray(value.imageIds)
        ? value.imageIds.filter(
            (id): id is string => typeof id === "string" && validImageIds.has(id)
          )
        : null;
      let imageIds = explicitImageIds ?? imageIdsInContext(context, docMarkdown, images);
      if (explicitImageIds === null && imageIds.length === 0 && fallback.imageIds.length > 0) {
        context = fallback.context;
        imageIds = fallback.imageIds;
      }
      return [{
        prompt: value.prompt,
        context,
        imageIds,
      }];
    });
  } catch {
    // Some models occasionally leave LaTeX backslashes unescaped despite JSON
    // mode. Recover the prompts, then derive context deterministically.
    const prompts = [...text.matchAll(/"prompt"\s*:\s*"((?:\\.|[^"\\])*)"/g)]
      .map((match) => {
        try {
          return JSON.parse(`"${match[1]}"`) as string;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return prompts.map((prompt) => ({
      prompt,
      ...correlateQuestionContext(prompt, docMarkdown, images),
    }));
  }
}

export interface SolveResult {
  answer: string;
  sources: string[];
  usedWebSearch: boolean;
}

/** Solve one question using the doc as context, with optional web search. */
export async function solveQuestion(
  question: Question,
  images: AssignmentImage[] = []
): Promise<SolveResult> {
  const ai = client();

  const prompt = `You are a study assistant helping a student understand and solve an assignment question.
Use the relevant source excerpt below as primary context. If figures from the document
are attached as images, read them as part of the context; they are specifically linked to the
diagram, chart, or data the question refers to. When helpful, use web search to find
accurate, up-to-date supporting information. Explain the answer clearly so the student
learns. Show reasoning and steps, not just a final answer.

Relevant source excerpt:
"""
${question.context.slice(0, 8000)}
"""

Question to solve:
${question.prompt}`;

  const contents = await buildContents(prompt, images);

  // Preferred path: answer with Google Search grounding enabled.
  try {
    const res = await withRetry(
      () =>
        ai.models.generateContent({
          model: model(),
          contents,
          config: {
            // Enable Google Search grounding so the agent can web-search.
            tools: [{ googleSearch: {} }],
          },
        }),
      "solving question with web search"
    );
    return readSolveResult(res, true);
  } catch (err) {
    // The web-search tool has a much lower free-tier quota than plain calls.
    // If it is rate-limited, fall back to answering without web search so the
    // student still gets a document-grounded answer instead of an error.
    if (!isRateLimit(err)) throw err;
    console.warn(
      "[gemini] web search rate-limited; retrying without web search"
    );
    const res = await withRetry(
      () =>
        ai.models.generateContent({
          model: model(),
          contents,
        }),
      "solving question without web search"
    );
    return readSolveResult(res, false);
  }
}

/** Extract the answer text and any grounding source URLs from a response. */
function readSolveResult(
  res: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>,
  usedWebSearch: boolean
): SolveResult {
  const answer = (res.text ?? "").trim();
  const sources = new Set<string>();
  const candidates = res.candidates ?? [];
  for (const c of candidates) {
    const chunks = c.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      const uri = chunk.web?.uri;
      if (uri) sources.add(uri);
    }
  }
  return { answer, sources: [...sources], usedWebSearch };
}

/** Build a fresh Question object from a prompt string. */
export function newQuestion(id: string, extracted: ExtractedQuestion): Question {
  return { id, ...extracted, answer: "", sources: [], done: false };
}
