// On-disk storage for document images extracted during ingestion.
//
// The SQLite row only stores lightweight metadata (see AssignmentImage); the
// actual image bytes live under server/data/assets/<assignmentId>/<id>.<ext>.
// The agent reads these back when building multimodal prompts, and they are
// served read-only at /api/assets/... for the UI.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import type { AssignmentImage } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = join(__dirname, "..", "data", "assets");

// A parsed image before it has been persisted (no id/path yet).
export interface RawImage {
  data: Buffer;
  mimeType: string;
  caption: string;
  page: number;
  sourcePath: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

function extFor(mimeType: string): string {
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? "bin";
}

/** Persist raw images for an assignment and return their stored metadata. */
export function saveAssignmentImages(
  assignmentId: string,
  images: RawImage[]
): AssignmentImage[] {
  if (images.length === 0) return [];
  const dir = join(ASSETS_DIR, assignmentId);
  mkdirSync(dir, { recursive: true });

  return images.map((img) => {
    const id = randomUUID();
    const rel = join(assignmentId, `${id}.${extFor(img.mimeType)}`);
    writeFileSync(join(ASSETS_DIR, rel), img.data);
    return {
      id,
      file: rel,
      mimeType: img.mimeType,
      caption: img.caption,
      page: img.page,
      sourcePath: img.sourcePath,
    };
  });
}

/** Read the raw bytes for a stored image (throws if missing). */
export function readImageBytes(file: string): Promise<Buffer> {
  return readFile(join(ASSETS_DIR, file));
}

/** Remove all stored images for an assignment (best-effort). */
export function deleteAssignmentAssets(assignmentId: string): void {
  const dir = join(ASSETS_DIR, assignmentId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
