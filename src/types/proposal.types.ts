export type RoleFitLevel = "strong" | "moderate" | "weak";

export interface RoleFitAssessment {
  fitLevel: RoleFitLevel;
  fitScore: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendation: string;
}

export interface ProposalReq {
  client_name: string;
  job_title: string;
  proposal_tone: "professional" | "conversational" | "confident" | "calm";
  job_summary: string;
  /** Optional Profile Optimizer root record ID for role-fit analysis */
  optimizer_record_id?: string;
}

export interface ProposalResponse {
  hook: string;
  solution: string;
  keyPoints: string[];
  portfolioLink: string;
  availability: string;
  support: string;
  closing: string;
  mdx: string;
  proposalId?: string; // Added for generation response
  version?: number; // Version number for tracking revisions
  versionId?: string; // Unique ID for this specific version
  /** Present when optimizer_record_id was provided on generate */
  roleFit?: RoleFitAssessment;
}

export interface AIErrorResponse {
  error: true;
  message: string;
  code: "OUT_OF_SCOPE" | "INVALID_INPUT" | "CONTENT_TOO_LONG" | "GENERAL_ERROR";
}

export type RefinementAction =
  | "expand_text"
  | "trim_text"
  | "simplify_text"
  | "improve_flow"
  | "change_tone"
  | "custom";

export interface ProposalHistory {
  id: string;
  userId: string;
  clientName: string;
  jobTitle: string;
  proposalTone: "professional" | "conversational" | "confident" | "calm";
  jobSummary: string;
  optimizerRecordId?: string;
  proposalResponse: ProposalResponse;
  createdAt: Date;
  updatedAt: Date;
  refinementCount: number;
  latestRefinementId?: string;
  allRefinementIds?: string[]; // Track all refinements
  refinements?: RefinementHistory[]; // Full refinement details for detailed views
  versions?: Array<{
    versionId: string;
    version: number;
    refinementLabel?: string;
    refinementType?: RefinementAction;
    proposal: ProposalResponse;
    createdAt: Date;
  }>; // All versions including refinements
}

export interface ProposalHistoryReq {
  page?: number;
  limit?: number;
  search?: string;
}

export interface RefineProposalReq {
  proposalId: string;
  refinementType: RefinementAction;
  newTone?: "professional" | "conversational" | "confident" | "calm";
  customInstruction?: string; // User's custom instruction for 'custom' refinement type
}

export interface RefinementHistory {
  id: string;
  proposalId: string;
  userId: string;
  refinementType: RefinementAction;
  refinementLabel: string; // Human-readable label for the refinement
  originalProposal: ProposalResponse;
  refinedProposal: ProposalResponse;
  createdAt: Date;
  order: number;
  version: number; // Version number (0 = original, 1, 2, 3, etc.)
}

export interface ProposalVersion {
  versionId: string;
  proposalId: string;
  version: number;
  proposal: ProposalResponse;
  refinementType?: RefinementAction;
  refinementLabel?: string;
  createdAt: Date;
}

// Helper constant for refinement labels
export const REFINEMENT_LABELS: Record<RefinementAction, string> = {
  expand_text: "Expanded Text",
  trim_text: "Trimmed Text",
  simplify_text: "Simplified Text",
  improve_flow: "Improved Flow",
  change_tone: "Changed Tone",
  custom: "Custom Refinement",
};
