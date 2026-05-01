import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type { ProposalHistory } from "../types/proposal.types.ts";
import type { OptimizerHistoryRecord } from "../types/optimizer-history.ts";
import type { Resume, ResumeContent } from "../types/resume.ts";
import {
  getUserProposalHistory,
  getUserOptimizerHistory,
} from "../utils/prompt.utils.ts";
import { resumeService } from "./resume.service.ts";
import type {
  KnowledgeBaseAccount,
  KnowledgeBaseCertification,
  KnowledgeBaseGetResponse,
  KnowledgeBaseImportBody,
  KnowledgeBaseMeta,
  KnowledgeBasePatchBody,
  KnowledgeBaseSections,
  KnowledgeBaseStored,
  SlimOptimizerEnrichment,
  SlimProposalEnrichment,
} from "../types/knowledge-base.ts";

const KB_COLLECTION = "knowledge_base";

/** Max items per list field on PATCH/import */
export const KB_MAX_ARRAY_LENGTH = 50;
export const KB_MAX_SUMMARY_LENGTH = 10_000;
export const KB_MAX_LOCATION_LENGTH = 200;
export const KB_MAX_STRING_FIELD = 2_000;
export const KB_MAX_DESCRIPTION_FIELD = 8_000;
export const KB_ENRICHMENT_LIMIT = 5;
export const KB_TEXT_PREVIEW_MAX = 800;

export function emptyKnowledgeSections(): KnowledgeBaseSections {
  return {
    professionalSummary: null,
    location: null,
    experienceYears: null,
    education: [],
    experience: [],
    skills: [],
    projects: [],
    certifications: [],
  };
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function previewFromOptimizerInput(
  input: OptimizerHistoryRecord["originalInput"],
): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  const parts = [
    input.fullName,
    input.professionalTitle,
    input.content,
  ].filter(Boolean);
  return parts.join("\n");
}

export function slimOptimizerRecord(
  r: OptimizerHistoryRecord,
): SlimOptimizerEnrichment {
  const raw = previewFromOptimizerInput(r.originalInput);
  return {
    id: r.id,
    optimizerType: r.optimizerType,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    originalInputPreview: truncate(raw, KB_TEXT_PREVIEW_MAX),
    optimizedOverviewPreview: truncate(
      r.response?.optimizedProfileOverview || "",
      KB_TEXT_PREVIEW_MAX,
    ),
  };
}

export function slimProposalRecord(p: ProposalHistory): SlimProposalEnrichment {
  const pr = p.proposalResponse;
  const pieces = [pr?.hook, pr?.solution, ...(pr?.keyPoints || [])].filter(
    Boolean,
  ) as string[];
  const textPreview = truncate(pieces.join("\n"), KB_TEXT_PREVIEW_MAX);
  return {
    id: p.id,
    clientName: p.clientName,
    jobTitle: p.jobTitle,
    proposalTone: p.proposalTone,
    jobSummary: truncate(p.jobSummary || "", KB_TEXT_PREVIEW_MAX),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    textPreview,
  };
}

function storedToSections(data: Record<string, unknown> | undefined): {
  sections: KnowledgeBaseSections;
} {
  if (!data) {
    return { sections: emptyKnowledgeSections() };
  }
  return {
    sections: {
      professionalSummary:
        typeof data.professionalSummary === "string"
          ? data.professionalSummary
          : null,
      location: typeof data.location === "string" ? data.location : null,
      experienceYears:
        typeof data.experienceYears === "number" &&
        !Number.isNaN(data.experienceYears)
          ? data.experienceYears
          : null,
      education: Array.isArray(data.education) ? data.education : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      skills: Array.isArray(data.skills) ? data.skills : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      certifications: Array.isArray(data.certifications)
        ? data.certifications
        : [],
    },
  };
}

async function fetchUserAccount(
  userId: string,
  fallbackEmail?: string,
  fallbackDisplayName?: string,
): Promise<KnowledgeBaseAccount> {
  const db = getFirestore(getFirebaseApp());
  const snap = await db
    .collection("users")
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (snap.empty || !snap.docs[0]) {
    return {
      displayName: fallbackDisplayName ?? null,
      email: fallbackEmail ?? null,
      professionalTitle: null,
      portfolioLink: null,
      tierId: null,
      country: null,
      state: null,
    };
  }

  const u = snap.docs[0].data();
  return {
    displayName:
      (typeof u.displayName === "string" ? u.displayName : null) ??
      fallbackDisplayName ??
      null,
    email:
      (typeof u.email === "string" ? u.email : null) ??
      fallbackEmail ??
      null,
    professionalTitle:
      typeof u.professionalTitle === "string" ? u.professionalTitle : null,
    portfolioLink:
      typeof u.portfolioLink === "string" ? u.portfolioLink : null,
    tierId: typeof u.tierId === "string" ? u.tierId : null,
    country: typeof u.country === "string" ? u.country : null,
    state: typeof u.state === "string" ? u.state : null,
  };
}

/**
 * Profile completion: 10 binary checks × 10 points each (documented weights).
 * 1 displayName 2 professionalTitle 3 professionalSummary 4 experience
 * 5 skills 6 education 7 certifications 8 projects 9 portfolioLink 10 location or experienceYears
 */
export function computeProfileCompletionPercent(
  account: KnowledgeBaseAccount,
  knowledge: KnowledgeBaseSections,
): number {
  const checks = [
    Boolean(account.displayName?.trim()),
    Boolean(account.professionalTitle?.trim()),
    Boolean(knowledge.professionalSummary?.trim()),
    knowledge.experience.length > 0,
    knowledge.skills.length > 0,
    knowledge.education.length > 0,
    knowledge.certifications.length > 0,
    knowledge.projects.length > 0,
    Boolean(account.portfolioLink?.trim()),
    Boolean(knowledge.location?.trim()) || knowledge.experienceYears != null,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

function normalizeCertificationsFromResume(
  raw: unknown[],
): KnowledgeBaseCertification[] {
  const out: KnowledgeBaseCertification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name =
      typeof o.name === "string"
        ? o.name
        : typeof o.title === "string"
          ? o.title
          : "";
    if (!name.trim()) continue;
    const issuer =
      typeof o.issuer === "string"
        ? o.issuer
        : typeof o.organization === "string"
          ? o.organization
          : typeof o.issuingOrganization === "string"
            ? o.issuingOrganization
            : undefined;
    const issueDate =
      typeof o.issueDate === "string"
        ? o.issueDate
        : typeof o.date === "string"
          ? o.date
          : undefined;
    const cert: KnowledgeBaseCertification = { name: name.trim() };
    if (issuer !== undefined) cert.issuer = issuer;
    if (issueDate !== undefined) cert.issueDate = issueDate;
    out.push(cert);
  }
  return out;
}

function sectionsFromResumeContent(
  content: ResumeContent,
): KnowledgeBaseSections {
  const pi = content.personalInfo;
  const city = pi?.city?.trim();
  const country = pi?.country?.trim();
  const location = [city, country].filter(Boolean).join(", ") || null;

  return {
    professionalSummary: pi?.summary?.trim() || null,
    location,
    experienceYears: null,
    education: Array.isArray(content.education) ? content.education : [],
    experience: Array.isArray(content.experience) ? content.experience : [],
    skills: Array.isArray(content.skills) ? content.skills : [],
    projects: Array.isArray(content.projects) ? content.projects : [],
    certifications: Array.isArray(content.certifications)
      ? normalizeCertificationsFromResume(content.certifications)
      : [],
  };
}

function mergeSections(
  current: KnowledgeBaseSections,
  incoming: KnowledgeBaseSections,
  overwrite: boolean,
): KnowledgeBaseSections {
  if (overwrite) {
    return {
      professionalSummary: incoming.professionalSummary ?? null,
      location: incoming.location ?? null,
      experienceYears: incoming.experienceYears ?? null,
      education: incoming.education,
      experience: incoming.experience,
      skills: incoming.skills,
      projects: incoming.projects,
      certifications: incoming.certifications,
    };
  }

  const pickStr = (a: string | null, b: string | null) =>
    a?.trim() ? a : b ?? null;

  const pickNum = (a: number | null, b: number | null) =>
    a != null ? a : b ?? null;

  const pickArr = <T>(a: T[], b: T[]) => (a.length > 0 ? a : b);

  return {
    professionalSummary: pickStr(
      current.professionalSummary,
      incoming.professionalSummary,
    ),
    location: pickStr(current.location, incoming.location),
    experienceYears: pickNum(current.experienceYears, incoming.experienceYears),
    education: pickArr(current.education, incoming.education),
    experience: pickArr(current.experience, incoming.experience),
    skills: pickArr(current.skills, incoming.skills),
    projects: pickArr(current.projects, incoming.projects),
    certifications: pickArr(current.certifications, incoming.certifications),
  };
}

export class KnowledgeBaseService {
  private db = getFirestore(getFirebaseApp());
  private col = this.db.collection(KB_COLLECTION);

  async getDocData(
    userId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const doc = await this.col.doc(userId).get();
    if (!doc.exists) return undefined;
    return doc.data() as Record<string, unknown>;
  }

  async getMergedResponse(
    userId: string,
    tokenEmail?: string,
    tokenDisplayName?: string,
  ): Promise<KnowledgeBaseGetResponse> {
    const [account, rawKb, resumes, optHist, propHist] = await Promise.all([
      fetchUserAccount(userId, tokenEmail, tokenDisplayName),
      this.getDocData(userId),
      resumeService.getResumes(userId),
      getUserOptimizerHistory(userId, 1, KB_ENRICHMENT_LIMIT),
      getUserProposalHistory(userId, 1, KB_ENRICHMENT_LIMIT),
    ]);

    const { sections: knowledge } = storedToSections(rawKb);

    const latestResume = resumes[0] as (Resume & { id: string }) | undefined;
    const meta: KnowledgeBaseMeta = {
      hasResume: resumes.length > 0,
      latestResumeId: latestResume?.id ?? null,
      profileCompletionPercent: computeProfileCompletionPercent(
        account,
        knowledge,
      ),
    };

    return {
      account,
      knowledge,
      enrichment: {
        recentOptimizations: optHist.records.map(slimOptimizerRecord),
        recentProposals: propHist.proposals.map(slimProposalRecord),
      },
      meta,
    };
  }

  validateAndNormalizePatch(body: KnowledgeBasePatchBody): {
    ok: true;
    data: KnowledgeBaseSections;
  } | { ok: false; message: string } {
    const base = emptyKnowledgeSections();
    const merged: KnowledgeBaseSections = { ...base, ...body };

    if (
      merged.professionalSummary != null &&
      merged.professionalSummary.length > KB_MAX_SUMMARY_LENGTH
    ) {
      return {
        ok: false,
        message: `professionalSummary exceeds ${KB_MAX_SUMMARY_LENGTH} characters`,
      };
    }
    if (
      merged.location != null &&
      merged.location.length > KB_MAX_LOCATION_LENGTH
    ) {
      return {
        ok: false,
        message: `location exceeds ${KB_MAX_LOCATION_LENGTH} characters`,
      };
    }
    if (
      merged.experienceYears != null &&
      (merged.experienceYears < 0 ||
        merged.experienceYears > 80 ||
        !Number.isFinite(merged.experienceYears))
    ) {
      return { ok: false, message: "experienceYears must be between 0 and 80" };
    }

    const arrays: [keyof KnowledgeBaseSections, unknown][] = [
      ["education", merged.education],
      ["experience", merged.experience],
      ["skills", merged.skills],
      ["projects", merged.projects],
      ["certifications", merged.certifications],
    ];
    for (const [key, arr] of arrays) {
      if (!Array.isArray(arr)) {
        return { ok: false, message: `${String(key)} must be an array` };
      }
      if (arr.length > KB_MAX_ARRAY_LENGTH) {
        return {
          ok: false,
          message: `${String(key)} cannot exceed ${KB_MAX_ARRAY_LENGTH} items`,
        };
      }
    }

    return { ok: true, data: merged };
  }

  async saveSections(
    userId: string,
    sections: KnowledgeBaseSections,
    isCreate: boolean,
  ): Promise<void> {
    const payload: KnowledgeBaseStored = {
      ...sections,
      updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
    };
    if (isCreate) {
      payload.createdAt = FieldValue.serverTimestamp() as unknown as Timestamp;
      await this.col.doc(userId).set(payload);
    } else {
      await this.col.doc(userId).update({
        ...sections,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  async patch(
    userId: string,
    body: KnowledgeBasePatchBody,
  ): Promise<KnowledgeBaseSections | { error: string }> {
    const validated = this.validateAndNormalizePatch(body);
    if (!validated.ok) return { error: validated.message };

    const existingRaw = await this.getDocData(userId);
    const { sections: existing } = storedToSections(existingRaw);

    const next: KnowledgeBaseSections = { ...existing };
    const nextRec = next as unknown as Record<string, unknown>;
    (Object.keys(body) as (keyof KnowledgeBasePatchBody)[]).forEach((k) => {
      if (body[k] !== undefined) {
        nextRec[k as string] = body[k];
      }
    });

    const fullCheck = this.validateAndNormalizePatch(next);
    if (!fullCheck.ok) return { error: fullCheck.message };

    const isCreate = !existingRaw;
    await this.saveSections(userId, next, isCreate);
    return next;
  }

  async importFromSources(
    userId: string,
    body: KnowledgeBaseImportBody,
  ): Promise<KnowledgeBaseSections | { error: string }> {
    const overwrite = body.overwrite === true;
    const existingRaw = await this.getDocData(userId);
    const { sections: existing } = storedToSections(existingRaw);

    let working = { ...existing };

    const applyResume = async () => {
      let resume: Resume & { id: string };
      try {
        if (body.resumeId) {
          resume = (await resumeService.getResumeById(
            userId,
            body.resumeId,
          )) as Resume & { id: string };
        } else {
          const list = await resumeService.getResumes(userId);
          if (!list.length) {
            return { error: "No resume found to import" } as const;
          }
          resume = list[0] as Resume & { id: string };
        }
      } catch {
        return { error: "Resume not found or access denied" } as const;
      }

      const fromResume = sectionsFromResumeContent(resume.content);
      working = mergeSections(working, fromResume, overwrite);
      return null;
    };

    const applyOptimizer = async () => {
      const { records } = await getUserOptimizerHistory(userId, 1, 1);
      const latest = records[0];
      if (!latest) {
        return { error: "No optimizer history found to import" } as const;
      }

      const contentPreview = truncate(
        previewFromOptimizerInput(latest.originalInput),
        KB_MAX_SUMMARY_LENGTH,
      );
      const overview = truncate(
        latest.response?.optimizedProfileOverview || "",
        KB_MAX_SUMMARY_LENGTH,
      );
      const combined =
        [contentPreview, overview].filter(Boolean).join("\n\n---\n\n") || null;

      if (overwrite) {
        working.professionalSummary = combined;
      } else if (!working.professionalSummary?.trim()) {
        working.professionalSummary = combined;
      }
      return null;
    };

    if (body.source === "resume") {
      const err = await applyResume();
      if (err) return err;
    } else if (body.source === "optimizer") {
      const err = await applyOptimizer();
      if (err) return err;
    } else if (body.source === "all") {
      const rErr = await applyResume();
      if (rErr) {
        const oErr = await applyOptimizer();
        if (oErr) return { error: "No resume or optimizer history to import" };
      } else {
        await applyOptimizer();
      }
    } else {
      return { error: "Invalid source" };
    }

    const validated = this.validateAndNormalizePatch(working);
    if (!validated.ok) return { error: validated.message };

    const isCreate = !existingRaw;
    await this.saveSections(userId, validated.data, isCreate);
    return validated.data;
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
