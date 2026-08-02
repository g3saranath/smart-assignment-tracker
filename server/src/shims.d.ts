// Ambient module declarations for libraries whose bundled types are missing
// the specific entry points we use.

// pdf-parse ships types only for its index; we import the impl file directly.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PDFParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  function pdfParse(buffer: Buffer): Promise<PDFParseResult>;
  export default pdfParse;
}

// mammoth exposes convertToMarkdown at runtime but omits it from its d.ts.
declare module "mammoth" {
  interface MammothResult {
    value: string;
    messages: unknown[];
  }
  interface MammothInput {
    buffer: Buffer;
  }
  export function convertToMarkdown(input: MammothInput): Promise<MammothResult>;
  export function convertToHtml(input: MammothInput): Promise<MammothResult>;
  const _default: {
    convertToMarkdown: typeof convertToMarkdown;
    convertToHtml: typeof convertToHtml;
  };
  export default _default;
}
