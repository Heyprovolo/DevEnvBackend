export type OptimizerType = "upwork" | "linkedin";

export type OptimizerSectionKey = keyof OptimizerResponseSections;

export type OptimizerTargetSection = OptimizerSectionKey | "all";

export interface OptimizerInput {
  fullName?: string;
  professionalTitle?: string;
  content: string;
}

export interface OptimizerResponseSections {
  weaknessesAndOptimization: string;
  optimizedProfileOverview: string;
  suggestedProjectTitles: string;
  recommendedVisuals: string;
  beforeAfterComparison: string;
}

export interface OptimizerHistoryRecord {
  id: string;
  userId: string;
  optimizerType: OptimizerType;
  originalInput: OptimizerInput;
  response: OptimizerResponseSections;
  createdAt: Date;
  updatedAt: Date;
  parentRecordId?: string;
  versionNumber?: number;
  latestVersionId?: string;
  userInstruction?: string;
  targetSection?: OptimizerTargetSection;
  refinementLabel?: string;
}

export interface OptimizerHistoryCreate {
  userId: string;
  optimizerType: OptimizerType;
  originalInput: OptimizerInput;
  response: OptimizerResponseSections;
}

export interface OptimizerRefinementCreate {
  userId: string;
  rootRecordId: string;
  optimizerType: OptimizerType;
  originalInput: OptimizerInput;
  response: OptimizerResponseSections;
  userInstruction: string;
  targetSection: OptimizerTargetSection;
  refinementLabel: string;
  versionNumber: number;
}

export interface OptimizerVersionSummary {
  id: string;
  versionNumber: number;
  refinementLabel?: string;
  userInstruction?: string;
  targetSection?: OptimizerTargetSection;
  createdAt: Date;
  response: OptimizerResponseSections;
}

export interface OptimizerHistoryWithVersions extends OptimizerHistoryRecord {
  versions: OptimizerVersionSummary[];
}

export interface RefineProfileReq {
  recordId: string;
  instruction: string;
  targetSection?: OptimizerTargetSection;
}

export interface OptimizerHistoryPagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
