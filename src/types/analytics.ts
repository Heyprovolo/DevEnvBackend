export type AnalyticsProfile = "dev" | "prod";

export type AnalyticsEventName =
  | "page_view"
  | "api_request"
  | "admin_action"
  | "web_vital"
  | "query_result"
  | "mutation_result";

export interface AnalyticsEventPayload {
  eventName: AnalyticsEventName | string;
  profile: AnalyticsProfile;
  eventTime?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  actionName?: string;
  metricName?: string;
  metricValue?: number;
  rating?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsSummary {
  totalEvents: number;
  pageViews: number;
  adminActions: number;
  apiRequests: number;
  apiSuccessRate: number;
  apiAverageDurationMs: number;
}
