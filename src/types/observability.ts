export type ErrorCategory =
  | "validation_error"
  | "auth_error"
  | "quota_error"
  | "external_api_error"
  | "db_error"
  | "http_4xx"
  | "http_5xx"
  | "internal_failure";

export interface RequestErrorDetails {
  category: ErrorCategory;
  type: string;
  message: string;
  stack?: string;
}

export interface RequestObservabilityEvent {
  kind: "request";
  timestamp: string;
  endpoint: string;
  route: string;
  method: string;
  feature: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  dbLatencyMs: number;
  externalLatencyMs: number;
  processingLatencyMs: number;
  userId?: string;
  sessionId?: string;
  requestId: string;
  requestPayload?: Record<string, unknown>;
  error?: RequestErrorDetails;
}

