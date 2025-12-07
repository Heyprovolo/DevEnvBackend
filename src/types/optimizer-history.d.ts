export type OptimizerType = "upwork" | "linkedin";

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
}

export interface OptimizerHistoryCreate {
  userId: string;
  optimizerType: OptimizerType;
  originalInput: OptimizerInput;
  response: OptimizerResponseSections;
}

export interface OptimizerHistoryPagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
