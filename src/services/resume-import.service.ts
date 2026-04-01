import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";

const SECTION_ALIASES = {
  summary: [
    "summary",
    "professional summary",
    "profile",
    "professional profile",
    "objective",
    "career objective",
    "about",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "employment history",
    "work history",
    "career history",
  ],
  education: ["education", "academic background", "academic history"],
  skills: ["skills", "technical skills", "core competencies", "competencies"],
  projects: ["projects", "project experience", "key projects"],
  certifications: ["certifications", "licenses", "licenses & certifications"],
  courses: ["courses", "coursework", "training"],
  internships: ["internships", "internship experience"],
  languages: ["languages", "language proficiency"],
  hobbies: ["hobbies", "interests", "hobbies & interests"],
  references: ["references"],
} as const;

type SectionKey = keyof typeof SECTION_ALIASES;

interface ImportedPersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  jobTitle: string;
  linkedinUrl: string;
  summary: string;
}

interface ImportedExperience {
  id: string;
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  location: string;
}

interface ImportedEducation {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

interface ImportedSkill {
  id: string;
  name: string;
  level: "Beginner" | "Intermediate" | "Advanced" | "Expert";
}

interface ImportedLanguage {
  id: string;
  name: string;
  proficiency:
    | "Basic"
    | "Beginner"
    | "Conversational"
    | "Intermediate"
    | "Fluent"
    | "Advanced"
    | "Native";
}

export interface ImportedResumeData {
  title: string;
  rawText: string;
  detectedSections: string[];
  content: {
    personalInfo: ImportedPersonalInfo;
    experience: ImportedExperience[];
    education: ImportedEducation[];
    skills: ImportedSkill[];
    languages: ImportedLanguage[];
    projects: never[];
    certifications: never[];
    courses: never[];
    internships: never[];
    hobbies: never[];
    references: never[];
    metadata: {
      importedFrom: "pdf";
      originalFileName: string;
      extractedAt: string;
      detectedSections: string[];
      rawText: string;
    };
  };
}

const MONTH_LOOKUP: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const SECTION_LOOKUP = new Map<string, SectionKey>(
  Object.entries(SECTION_ALIASES).flatMap(([section, aliases]) =>
    aliases.map((alias) => [normalizeHeading(alias), section as SectionKey]),
  ),
);

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim());
}

function findSectionKey(line: string): SectionKey | null {
  if (!line) {
    return null;
  }

  return SECTION_LOOKUP.get(normalizeHeading(line)) ?? null;
}

function partitionSections(lines: string[]) {
  const sections: Partial<Record<SectionKey, string[]>> = {};
  const detectedSections: SectionKey[] = [];
  let currentSection: SectionKey | null = null;
  const headerLines: string[] = [];

  for (const line of lines) {
    const sectionKey = findSectionKey(line);

    if (sectionKey) {
      currentSection = sectionKey;
      if (!detectedSections.includes(sectionKey)) {
        detectedSections.push(sectionKey);
      }
      if (!sections[sectionKey]) {
        sections[sectionKey] = [];
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection]?.push(line);
    } else {
      headerLines.push(line);
    }
  }

  return { headerLines, sections, detectedSections };
}

function cleanSectionLines(lines: string[] | undefined): string[] {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function isContactLine(line: string): boolean {
  return Boolean(
    line.match(
      /@|https?:\/\/|linkedin\.com|github\.com|portfolio|\+?\d[\d\s().-]{6,}/i,
    ),
  );
}

function isLikelyName(line: string): boolean {
  if (!line || isContactLine(line)) {
    return false;
  }

  if (/[^a-zA-Z\s.'-]/.test(line)) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5;
}

function splitLocation(location: string) {
  const segments = location
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return {
    city: segments[0] ?? "",
    country: segments.length > 1 ? (segments[segments.length - 1] ?? "") : "",
  };
}

function extractHeaderInfo(headerLines: string[], summaryLines: string[]) {
  const emailMatch = headerLines
    .join(" ")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = headerLines
    .join(" ")
    .match(
      /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{3,4}[\s.-]?\d{0,4}/,
    );
  const linkedInMatch = headerLines
    .join(" ")
    .match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);

  const nonContactLines = headerLines.filter(
    (line) => line && !isContactLine(line),
  );
  const nameLine =
    nonContactLines.find(isLikelyName) ?? nonContactLines[0] ?? "";
  const { firstName, lastName } = splitName(nameLine);

  const remainingLines = nonContactLines.filter((line) => line !== nameLine);
  const jobTitle = remainingLines[0] ?? "";
  const locationLine =
    remainingLines.find(
      (line) => /,/.test(line) && !/experience|education|skills/i.test(line),
    ) ?? "";
  const { city, country } = splitLocation(locationLine);

  return {
    firstName,
    lastName,
    email: emailMatch?.[0] ?? "",
    phone: phoneMatch?.[0]?.trim() ?? "",
    city,
    country,
    jobTitle,
    linkedinUrl: linkedInMatch?.[0] ?? "",
    summary: summaryLines.join(" ").trim(),
  };
}

function splitSectionEntries(lines: string[]): string[][] {
  const entries: string[][] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (current.length > 0) {
        entries.push(current);
        current = [];
      }
      continue;
    }

    const startsNewEntry =
      current.length > 0 &&
      !line.startsWith("•") &&
      !line.startsWith("-") &&
      looksLikeEntryTitle(line) &&
      current.length >= 2;

    if (startsNewEntry) {
      entries.push(current);
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    entries.push(current);
  }

  return entries.filter((entry) => entry.some(Boolean));
}

function looksLikeEntryTitle(line: string): boolean {
  if (!line || line.length > 120) {
    return false;
  }

  return (
    /[A-Za-z]/.test(line) &&
    !isDateRangeText(line) &&
    !line.startsWith("•") &&
    !line.startsWith("-")
  );
}

function isDateRangeText(line: string): boolean {
  return /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|present|current|\d{4})/i.test(
    line,
  );
}

function parseMonthToken(token: string): string {
  const trimmed = token.trim();
  const monthYearMatch = trimmed.match(/([A-Za-z]+)\s+(\d{4})/);
  if (monthYearMatch) {
    const [, monthText = "", year = ""] = monthYearMatch;
    const month = MONTH_LOOKUP[monthText.toLowerCase()];
    if (month) {
      return `${year}-${month}`;
    }
  }

  const slashMatch = trimmed.match(/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, monthNumber = "", year = ""] = slashMatch;
    if (monthNumber && year) {
      return `${year}-${monthNumber.padStart(2, "0")}`;
    }
  }

  const yearMatch = trimmed.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return `${yearMatch[0]}-01`;
  }

  return "";
}

function extractDateRange(line: string) {
  const normalized = line.replace(/[|•]/g, " ").replace(/\s+/g, " ").trim();
  const tokens =
    normalized.match(
      /(?:[A-Za-z]{3,9}\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|Present|Current)/gi,
    ) ?? [];

  const startDate = tokens[0] ? parseMonthToken(tokens[0]) : "";
  const endToken = tokens[1] ?? "";
  const current = /present|current/i.test(endToken);
  const endDate = current ? "" : parseMonthToken(endToken);

  return {
    startDate,
    endDate,
    current,
  };
}

function parseRoleAndCompany(line: string) {
  const separators = [" at ", " @ ", " | ", " - ", " — ", " – "];
  for (const separator of separators) {
    if (line.includes(separator)) {
      const [left, ...rest] = line.split(separator);
      return {
        position: (left ?? "").trim(),
        company: rest.join(separator).trim(),
      };
    }
  }

  return {
    position: line.trim(),
    company: "",
  };
}

function parseExperience(lines: string[]): ImportedExperience[] {
  return splitSectionEntries(lines)
    .map((entry) => {
      const [titleLine = "", secondLine = "", ...rest] = entry;
      const metaLine = isDateRangeText(secondLine) ? secondLine : "";
      const descriptionLines = metaLine ? rest : [secondLine, ...rest];
      const { position, company } = parseRoleAndCompany(titleLine);
      const { startDate, endDate, current } = extractDateRange(metaLine);
      const location = metaLine.includes("|")
        ? metaLine.split("|").slice(1).join("|").trim()
        : "";

      return {
        id: randomUUID(),
        company,
        position,
        startDate,
        endDate,
        current,
        location,
        description: descriptionLines
          .map((line) => line.replace(/^[•-]\s*/, "").trim())
          .filter(Boolean)
          .join(" "),
      };
    })
    .filter((entry) => entry.position || entry.company || entry.description);
}

function parseEducation(lines: string[]): ImportedEducation[] {
  return splitSectionEntries(lines)
    .map((entry) => {
      const [titleLine = "", secondLine = "", ...rest] = entry;
      const metaLine = isDateRangeText(secondLine) ? secondLine : "";
      const descriptionLines = metaLine ? rest : [secondLine, ...rest];
      const { position, company } = parseRoleAndCompany(titleLine);
      const { startDate, endDate, current } = extractDateRange(metaLine);

      return {
        id: randomUUID(),
        institution: company || secondLine,
        degree: position,
        fieldOfStudy: "",
        location: metaLine.includes("|")
          ? metaLine.split("|").slice(1).join("|").trim()
          : "",
        startDate,
        endDate,
        current,
        description: descriptionLines
          .map((line) => line.replace(/^[•-]\s*/, "").trim())
          .filter(Boolean)
          .join(" "),
      };
    })
    .filter((entry) => entry.degree || entry.institution || entry.description);
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseSkills(lines: string[]): ImportedSkill[] {
  const tokens = uniqueValues(
    lines
      .join("\n")
      .split(/\n|,|\||•|·/)
      .map((token) => token.replace(/^[-*]\s*/, "").trim()),
  );

  return tokens.slice(0, 30).map((name) => ({
    id: randomUUID(),
    name,
    level: "Intermediate",
  }));
}

function parseLanguages(lines: string[]): ImportedLanguage[] {
  const tokens = uniqueValues(
    lines
      .join("\n")
      .split(/\n|,|\||•|·/)
      .map((token) => token.replace(/^[-*]\s*/, "").trim()),
  );

  return tokens.slice(0, 10).map((name) => ({
    id: randomUUID(),
    name,
    proficiency: "Intermediate",
  }));
}

export async function importResumeFromPdf(
  pdfBuffer: Buffer,
  fileName: string,
): Promise<ImportedResumeData> {
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const result = await parser.getText();
    const rawText = normalizePdfText(result.text ?? "");

    if (!rawText) {
      throw new Error("No readable text was found in the uploaded PDF");
    }

    const lines = parseLines(rawText);
    const { headerLines, sections, detectedSections } =
      partitionSections(lines);

    const summaryLines = cleanSectionLines(sections.summary);
    const personalInfo = extractHeaderInfo(
      headerLines.filter(Boolean),
      summaryLines,
    );
    const baseTitle =
      `${personalInfo.firstName} ${personalInfo.lastName}`.trim();
    const title =
      baseTitle || fileName.replace(/\.pdf$/i, "") || "Imported Resume";

    return {
      title,
      rawText,
      detectedSections,
      content: {
        personalInfo,
        experience: parseExperience(sections.experience ?? []),
        education: parseEducation(sections.education ?? []),
        skills: parseSkills(sections.skills ?? []),
        languages: parseLanguages(sections.languages ?? []),
        projects: [],
        certifications: [],
        courses: [],
        internships: [],
        hobbies: [],
        references: [],
        metadata: {
          importedFrom: "pdf",
          originalFileName: fileName,
          extractedAt: new Date().toISOString(),
          detectedSections,
          rawText,
        },
      },
    };
  } finally {
    await parser.destroy();
  }
}
