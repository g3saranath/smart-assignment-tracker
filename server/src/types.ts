// Shared domain types for the assignment tracker.

export interface Question {
  id: string;
  prompt: string;
  context: string; // focused source excerpt relevant to this question
  imageIds: string[]; // figures correlated with this question
  answer: string; // agent-generated or student-edited answer ("" if unsolved)
  sources: string[]; // web-search source URLs the agent used
  done: boolean;
}

// A figure/diagram extracted from the source document (via MinerU OCR).
// The bytes live on disk under the assets dir; `file` is the relative path.
export interface AssignmentImage {
  id: string;
  file: string; // path relative to the assets dir, e.g. "<assignmentId>/<id>.jpg"
  mimeType: string; // e.g. "image/jpeg", "image/png"
  caption: string; // MinerU-detected caption ("" if none)
  page: number; // 0-based source page index, -1 if unknown
  sourcePath: string; // original path referenced by MinerU markdown
}

export interface Assignment {
  id: string;
  title: string;
  course: string;
  dueDate: string; // YYYY-MM-DD, "" if unknown
  docMarkdown: string; // ingested source document, converted to markdown
  images: AssignmentImage[]; // figures extracted from the document (may be empty)
  questions: Question[];
  createdAt: string; // ISO timestamp
}

export interface Settings {
  studentEmail: string;
  notifyEnabled: boolean;
  lastNotifiedAt: string; // ISO timestamp, "" if never
}

export interface DB {
  assignments: Assignment[];
  settings: Settings;
}
