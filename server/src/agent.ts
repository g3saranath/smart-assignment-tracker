// The agentic core. Two jobs:
//   1. extractQuestions() — read the ingested doc markdown and pull out the
//      individual questions/tasks the student must complete.
//   2. solveQuestion()   — answer one question using the document as context
//      PLUS live Google Search grounding, returning the answer + source URLs.

import { GoogleGenAI } from "@google/genai";
import type { Question } from "./types.js";

// Model is configurable via .env so you can switch tiers/models without code
// changes (e.g. GEMINI_MODEL=gemini-flash-latest). These are read at call time
// (not import time) because ES module imports run before dotenv loads .env.
const model = () => process.env.GEMINI_MODEL || "gemini-flash-latest";
const maxRetries = () => Number(process.env.GEMINI_MAX_RETRIES || 3);

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
      if (!isRateLimit(err)) throw err;

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
        `[gemini] rate-limited while ${label}; retry ${attempt + 1}/${retries} in ${Math.round(waitMs / 1000)}s`
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

/** Read the document and extract a list of question prompts. */
export async function extractQuestions(docMarkdown: string): Promise<string[]> {
  const ai = client();
  const prompt = `You are helping a student break an assignment into its individual questions.

Below is the assignment document (in markdown). Extract every distinct question,
problem, or task the student is asked to complete. Keep each question's full text.

Return ONLY a JSON array of strings, one per question. No markdown fences, no commentary.

Assignment document:
"""
${docMarkdown.slice(0, 30000)}
"""`;

  const res = await withRetry(
    () =>
      ai.models.generateContent({
        model: model(),
        contents: prompt,
      }),
    "extracting questions"
  );

  const text = stripFences(res.text ?? "[]");
  try {
    const arr = JSON.parse(text) as string[];
    return Array.isArray(arr) ? arr.filter((q) => typeof q === "string") : [];
  } catch {
    return [];
  }
}

export interface SolveResult {
  answer: string;
  sources: string[];
  usedWebSearch: boolean;
}

/** Solve one question using the doc as context, with optional web search. */
export async function solveQuestion(
  question: string,
  docMarkdown: string
): Promise<SolveResult> {
  const ai = client();

  const prompt = `You are a study assistant helping a student understand and solve an assignment question.
Use the assignment document below as primary context. When helpful, use web search
to find accurate, up-to-date supporting information. Explain the answer clearly so the
student learns. Show reasoning and steps, not just a final answer.

Assignment document (context):
"""
${docMarkdown.slice(0, 20000)}
"""

Question to solve:
${question}`;

  // Preferred path: answer with Google Search grounding enabled.
  try {
    const res = await withRetry(
      () =>
        ai.models.generateContent({
          model: model(),
          contents: prompt,
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
          contents: prompt,
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
export function newQuestion(id: string, prompt: string): Question {
  return { id, prompt, answer: "", sources: [], done: false };
}
