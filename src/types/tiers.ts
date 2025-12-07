export type RecurringInterval = "daily" | "weekly" | "monthly" | "yearly";
export type PlanRecurringInterval = "monthly" | "yearly";
export type FeatureSlug =
  | "upwork_profile_optimizer"
  | "linkedin_profile_optimizer"
  | "ai_proposals"
  | "resume_generator"
  | "advanced_ai_insights"
  | "comunity_access"
  | "newsletters"
  | "freelancer_growth_tools"
  | "optimization_history"
  | "proposal_history";

export interface Feature {
  name: string;
  description: string;
  slug: FeatureSlug;
  limited: boolean;
  maxQuota: number;
  recurringInterval: RecurringInterval | "";
}

export interface Tier {
  name: string;
  slug: string;
  polarRefId: string;
  price: number;
  description: string;
  recurringInterval: PlanRecurringInterval;
  features: Feature[];
  createdAt: Date;
  updatedAt: Date;
}
