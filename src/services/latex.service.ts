import nodeLatex from "node-latex";
import { Readable } from "stream";

const latex = nodeLatex as unknown as (
  input: Readable | string,
  options?: Record<string, unknown>
) => NodeJS.ReadableStream;

const DANGEROUS_COMMANDS = [
  "\\input",
  "\\include",
  "\\write18",
  "\\immediate",
  "\\openout",
  "\\openin",
  "\\read",
  "\\write",
  "\\newwrite",
  "\\newread",
  "\\closein",
  "\\closeout",
];

const MAX_CONTENT_LENGTH = 500_000; // 500KB

// pdflatex commonly fails on emoji and zero-width joiners unless explicit
// unicode/font packages are configured. Strip those characters defensively.
function stripUnsupportedUnicode(content: string): string {
  return content.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "");
}

function sanitize(content: string): string {
  if (!content || typeof content !== "string") {
    throw new Error("LaTeX content must be a non-empty string");
  }

  const sanitizedContent = stripUnsupportedUnicode(content);

  if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `LaTeX content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`
    );
  }

  for (const cmd of DANGEROUS_COMMANDS) {
    if (sanitizedContent.includes(cmd)) {
      throw new Error(`Forbidden LaTeX command detected: ${cmd}`);
    }
  }

  return sanitizedContent;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function compileToPdf(latexContent: string): Promise<Buffer> {
  const sanitizedLatex = sanitize(latexContent);

  const pdfStream = latex(sanitizedLatex, {
    cmd: "pdflatex",
    passes: 2,
  });

  return streamToBuffer(pdfStream);
}
