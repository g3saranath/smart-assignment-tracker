import type { AssignmentImage } from "./types.js";

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g;
const WORD_RE = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "that", "the", "this", "to", "using", "with",
]);

function basename(path: string): string {
  return path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase();
}

function imageRefs(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE_RE)].map((m) => m[1]);
}

function linkedImageIds(markdown: string, document: string, images: AssignmentImage[]): string[] {
  const refs = imageRefs(markdown);
  const allRefs = imageRefs(document);
  const ids = new Set<string>();

  for (const ref of refs) {
    const refName = basename(ref);
    const byPath = images.find((img) => img.sourcePath && basename(img.sourcePath) === refName);
    if (byPath) {
      ids.add(byPath.id);
      continue;
    }

    // Older saved images predate sourcePath. MinerU and markdown preserve the
    // same reading order, so the reference index is a reliable fallback.
    const index = allRefs.findIndex((candidate) => basename(candidate) === refName);
    if (index >= 0 && images[index]) ids.add(images[index].id);
  }
  return [...ids];
}

function captionMatchIds(prompt: string, images: AssignmentImage[]): string[] {
  const promptPart = partNumber(prompt);
  return images
    .filter((image) => {
      if (!image.caption) return false;
      const samePart = promptPart && partNumber(image.caption) === promptPart;
      const figure = prompt.match(/\bfigure\s+([\d.]+)/i)?.[1];
      const sameFigure = figure && new RegExp(`\\bfigure\\s+${figure.replace(".", "\\.")}`, "i").test(image.caption);
      return !!samePart || !!sameFigure;
    })
    .map((image) => image.id);
}

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(WORD_RE) ?? []).filter(
      (word) => word.length > 2 && !STOP_WORDS.has(word)
    )
  );
}

function partNumber(text: string): string | null {
  return text.match(/\bpart\s+(\d+(?:\.\d+)?)/i)?.[1] ?? null;
}

/** Find the source section most similar to a question and its inline figures. */
export function correlateQuestionContext(
  prompt: string,
  document: string,
  images: AssignmentImage[]
): { context: string; imageIds: string[] } {
  const sections = document
    .split(/(?=^#{1,6}\s)/m)
    .map((section) => section.trim())
    .filter(Boolean);
  if (sections.length === 0) return { context: prompt, imageIds: [] };

  const promptWords = words(prompt);
  const promptPart = partNumber(prompt);
  let best = sections[0];
  let bestScore = -1;
  for (const section of sections) {
    const sectionWords = words(section);
    let overlap = 0;
    for (const word of promptWords) if (sectionWords.has(word)) overlap += 1;
    const heading = section.split("\n", 1)[0];
    const headingBonus = promptPart && partNumber(heading) === promptPart ? 2 : 0;
    const score = headingBonus + overlap / Math.max(promptWords.size, 1);
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }

  const context = best.slice(0, 8000);
  const captionMatches = captionMatchIds(prompt, images);
  return {
    context,
    imageIds: captionMatches.length > 0
      ? captionMatches
      : linkedImageIds(context, document, images),
  };
}

/** Resolve image references included in a model-selected verbatim excerpt. */
export function imageIdsInContext(
  context: string,
  document: string,
  images: AssignmentImage[]
): string[] {
  return linkedImageIds(context, document, images);
}
