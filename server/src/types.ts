// Shared domain types for the assignment tracker.

export interface Question {
  id: string;
  prompt: string;
  answer: string; // agent-generated or student-edited answer ("" if unsolved)
  sources: string[]; // web-search source URLs the agent used
  done: boolean;
}

export interface Assignment {
  id: string;
  title: string;
  course: string;
  dueDate: string; // YYYY-MM-DD, "" if unknown
  docMarkdown: string; // ingested source document, converted to markdown
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
