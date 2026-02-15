import nodeLatex from "node-latex";
import { Readable } from "stream";

const latex = nodeLatex as unknown as (
  input: Readable | string,
  options?: Record<string, unknown>,
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

function sanitize(content: string): void {
  if (!content || typeof content !== "string") {
    throw new Error("LaTeX content must be a non-empty string");
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `LaTeX content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`,
    );
  }

  for (const cmd of DANGEROUS_COMMANDS) {
    if (content.includes(cmd)) {
      throw new Error(`Forbidden LaTeX command detected: ${cmd}`);
    }
  }
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
  sanitize(latexContent);

  const pdfStream = latex(latexContent, {
    cmd: "pdflatex",
    passes: 2,
  });

  return streamToBuffer(pdfStream);
}
