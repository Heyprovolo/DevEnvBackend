import type { Timestamp } from "firebase-admin/firestore";
import type {
  EducationItem,
  ExperienceItem,
  ProjectItem,
  SkillItem,
} from "./resume.ts";

/** Stored on Firestore doc `knowledge_base/{userId}` */
export interface KnowledgeBaseCertification {
  name: string;
  issuer?: string;
  issueDate?: string;
}

export interface KnowledgeBaseStored {
  professionalSummary: string | null;
  location: string | null;
  experienceYears: number | null;
  education: EducationItem[];
  experience: ExperienceItem[];
  skills: SkillItem[];
  projects: ProjectItem[];
  certifications: KnowledgeBaseCertification[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/** Editable knowledge sections (API `knowledge` + PATCH body subset) */
export interface KnowledgeBaseSections {
  professionalSummary: string | null;
  location: string | null;
  experienceYears: number | null;
  education: EducationItem[];
  experience: ExperienceItem[];
  skills: SkillItem[];
  projects: ProjectItem[];
  certifications: KnowledgeBaseCertification[];
}

export interface KnowledgeBaseAccount {
  displayName: string | null;
  email: string | null;
  professionalTitle: string | null;
  portfolioLink: string | null;
  tierId: string | null;
  /** Inferred from CDN / request when user last signed in; null if unknown. */
  country: string | null;
  /** Subdivision when available; null if unknown. */
  state: string | null;
}

export interface SlimOptimizerEnrichment {
  id: string;
  optimizerType: "upwork" | "linkedin";
  createdAt: string;
  updatedAt: string;
  originalInputPreview: string;
  optimizedOverviewPreview: string;
}

export interface SlimProposalEnrichment {
  id: string;
  clientName: string;
  jobTitle: string;
  proposalTone: string;
  jobSummary: string;
  createdAt: string;
  updatedAt: string;
  textPreview: string;
}

export interface KnowledgeBaseMeta {
  hasResume: boolean;
  latestResumeId: string | null;
  profileCompletionPercent: number;
}

export interface KnowledgeBaseGetResponse {
  account: KnowledgeBaseAccount;
  knowledge: KnowledgeBaseSections;
  enrichment: {
    recentOptimizations: SlimOptimizerEnrichment[];
    recentProposals: SlimProposalEnrichment[];
  };
  meta: KnowledgeBaseMeta;
}

export type KnowledgeBasePatchBody = Partial<KnowledgeBaseSections>;

export type KnowledgeBaseImportSource = "resume" | "optimizer" | "all";

export interface KnowledgeBaseImportBody {
  source: KnowledgeBaseImportSource;
  /** When source is resume or all; defaults to latest resume by updatedAt */
  resumeId?: string;
  /**
   * When false (default), only fills empty KB fields from the import source.
   * When true, overwrites matching sections from that source (resume: full section replace; optimizer: summary fields).
   */
  overwrite?: boolean;
}
