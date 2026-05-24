/** Shared free-form refine instruction limits (profile + proposals). */
export const REFINE_INSTRUCTION_MIN = 10;
export const REFINE_INSTRUCTION_MAX = 500;

const HTML_TAG_PATTERN = /<[^>]+>/;

export type RefineInstructionScope = "proposal" | "profile";

const scopeLabel: Record<RefineInstructionScope, string> = {
  proposal: "proposal",
  profile: "profile",
};

const blockedPatterns = (
  scope: RefineInstructionScope,
): { pattern: RegExp; message: string }[] => {
  const label = scopeLabel[scope];
  const scopeOnly =
    scope === "proposal"
      ? "Upwork proposals"
      : "profile optimizations";
  return [
    {
      pattern: /<\s*script\b/i,
      message: "Script tags are not allowed in refinement instructions.",
    },
    {
      pattern: /<\s*iframe\b/i,
      message: "HTML markup is not allowed in refinement instructions.",
    },
    {
      pattern: /javascript\s*:/i,
      message: "Invalid content in refinement instructions.",
    },
    {
      pattern: /\bon\w+\s*=/i,
      message: "Invalid content in refinement instructions.",
    },
    {
      pattern: /ignore\s+(all\s+)?(previous|prior|above|system)\s+instructions/i,
      message: `Instructions must only describe how to improve your ${label}, not change AI behavior.`,
    },
    {
      pattern: /disregard\s+(your\s+)?(system|instructions|rules)/i,
      message: `Instructions must only describe how to improve your ${label}, not change AI behavior.`,
    },
    {
      pattern: /override\s+(the\s+)?(system|instructions|rules)/i,
      message: `Instructions must only describe how to improve your ${label}, not change AI behavior.`,
    },
    {
      pattern: /you\s+are\s+now\s+(a|an)\s+/i,
      message: `Instructions must stay within ${label} editing — not role-play or jailbreaks.`,
    },
    {
      pattern: /pretend\s+(you\s+are|to\s+be)/i,
      message: `Instructions must stay within ${label} editing — not role-play or jailbreaks.`,
    },
    {
      pattern: /respond\s+with\s+(only\s+)?(plain\s+)?text/i,
      message: "Output format cannot be changed. Describe content edits only.",
    },
    {
      pattern: /do\s+not\s+use\s+json/i,
      message: "Output format cannot be changed. Describe content edits only.",
    },
    {
      pattern: /write\s+(me\s+)?(code|a\s+python|a\s+javascript|an?\s+app)/i,
      message: `This tool only refines ${scopeOnly} — not code or general tasks.`,
    },
    {
      pattern: /debug\s+(this|my|the)\s+(code|app|error)/i,
      message: `This tool only refines ${scopeOnly} — not debugging or technical help.`,
    },
  ];
};

export interface RefineInstructionValidation {
  valid: boolean;
  sanitized: string;
  message?: string;
}

export function validateRefineInstruction(
  raw: string,
  scope: RefineInstructionScope = "profile",
): RefineInstructionValidation {
  const sanitized = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();

  if (sanitized.length < REFINE_INSTRUCTION_MIN) {
    return {
      valid: false,
      sanitized,
      message: `Instruction must be at least ${REFINE_INSTRUCTION_MIN} characters.`,
    };
  }

  if (sanitized.length > REFINE_INSTRUCTION_MAX) {
    return {
      valid: false,
      sanitized,
      message: `Instruction must be ${REFINE_INSTRUCTION_MAX} characters or less.`,
    };
  }

  if (HTML_TAG_PATTERN.test(sanitized)) {
    return {
      valid: false,
      sanitized,
      message: "HTML tags are not allowed. Use plain text only.",
    };
  }

  for (const { pattern, message } of blockedPatterns(scope)) {
    if (pattern.test(sanitized)) {
      return { valid: false, sanitized, message };
    }
  }

  return { valid: true, sanitized };
}
