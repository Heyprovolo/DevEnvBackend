import type { Request, Response } from "express";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import { getBackendAlerts, getBackendDashboardMetrics } from "../services/observability.service.ts";
import { timedDb } from "../middlewares/observability.middleware.ts";

export async function backendDashboardController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const metrics = await timedDb(req, () =>
      getBackendDashboardMetrics(from as string | undefined, to as string | undefined)
    );
    return res.status(200).json(newSuccessResponse("Backend Metrics", "Dashboard-ready backend metrics", metrics));
  } catch (error) {
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Failed to compute backend metrics"));
  }
}

export async function backendAlertsController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const alerts = await timedDb(req, () =>
      getBackendAlerts(from as string | undefined, to as string | undefined)
    );
    return res.status(200).json(newSuccessResponse("Backend Alerts", "Alert thresholds and anomalies", alerts));
  } catch (error) {
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Failed to compute backend alerts"));
  }
}

export function backendSchemaController(_req: Request, res: Response) {
  return res.status(200).json(
    newSuccessResponse("Backend Observability Schema", "Structured log/event schema for dashboards", {
      collection: "backend_observability_events",
      fields: [
        "kind",
        "timestamp",
        "endpoint",
        "route",
        "method",
        "feature",
        "statusCode",
        "success",
        "durationMs",
        "dbLatencyMs",
        "externalLatencyMs",
        "processingLatencyMs",
        "userId",
        "sessionId",
        "requestId",
        "requestPayload",
        "error.category",
        "error.type",
        "error.message",
        "error.stack",
      ],
      integrations: [
        "Datadog: forward JSON logs via stdout log pipeline",
        "ELK/OpenSearch: ingest JSON lines and index by endpoint/timestamp",
        "Grafana: use Firestore datasource or log shipper into Loki/Elasticsearch",
        "New Relic: send structured logs and map requestId/userId fields",
      ],
    })
  );
}

