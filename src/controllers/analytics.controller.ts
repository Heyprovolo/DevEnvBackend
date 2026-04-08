import type { Request, Response } from "express";
import { z } from "zod";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import {
  getAnalyticsSummary,
  getAnalyticsTimeseries,
  getTopActions,
  getTopApis,
  ingestAnalyticsEvents,
} from "../services/analytics.service.ts";
import type { AnalyticsEventPayload } from "../types/analytics.ts";

const profileSchema = z.enum(["dev", "prod"]);

const eventSchema = z.object({
  eventName: z.string().min(1).max(64),
  profile: profileSchema,
  eventTime: z.string().datetime().optional(),
  route: z.string().max(256).optional(),
  method: z.string().max(16).optional(),
  statusCode: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().min(0).optional(),
  actionName: z.string().max(128).optional(),
  metricName: z.string().max(64).optional(),
  metricValue: z.number().optional(),
  rating: z.string().max(16).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ingestSchema = z.object({
  events: z.array(eventSchema).max(100).optional(),
  eventName: z.string().min(1).max(64).optional(),
  profile: profileSchema.optional(),
  eventTime: z.string().datetime().optional(),
  route: z.string().max(256).optional(),
  method: z.string().max(16).optional(),
  statusCode: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().min(0).optional(),
  actionName: z.string().max(128).optional(),
  metricName: z.string().max(64).optional(),
  metricValue: z.number().optional(),
  rating: z.string().max(16).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function normalizeEvents(body: z.infer<typeof ingestSchema>): AnalyticsEventPayload[] {
  if (body.events && body.events.length > 0) return body.events;
  if (body.eventName && body.profile) {
    const singleEvent: AnalyticsEventPayload = {
      eventName: body.eventName,
      profile: body.profile,
    };
    if (body.eventTime !== undefined) singleEvent.eventTime = body.eventTime;
    if (body.route !== undefined) singleEvent.route = body.route;
    if (body.method !== undefined) singleEvent.method = body.method;
    if (body.statusCode !== undefined) singleEvent.statusCode = body.statusCode;
    if (body.durationMs !== undefined) singleEvent.durationMs = body.durationMs;
    if (body.actionName !== undefined) singleEvent.actionName = body.actionName;
    if (body.metricName !== undefined) singleEvent.metricName = body.metricName;
    if (body.metricValue !== undefined) singleEvent.metricValue = body.metricValue;
    if (body.rating !== undefined) singleEvent.rating = body.rating;
    if (body.metadata !== undefined) singleEvent.metadata = body.metadata;
    return [
      singleEvent,
    ];
  }
  return [];
}

export async function ingestAnalyticsController(req: Request, res: Response) {
  try {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(newErrorResponse("Invalid Request", "Invalid analytics event payload"));
    }

    const events = normalizeEvents(parsed.data);
    if (events.length === 0) {
      return res.status(400).json(newErrorResponse("Invalid Request", "No analytics events were provided"));
    }

    const insertedCount = await ingestAnalyticsEvents(events);
    return res
      .status(202)
      .json(newSuccessResponse("Accepted", "Analytics events were accepted", { insertedCount }));
  } catch (error) {
    console.error("[ingestAnalyticsController] Failed to ingest analytics events", error);
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Failed to ingest analytics events"));
  }
}

export async function summaryAnalyticsController(req: Request, res: Response) {
  try {
    const { from, to, profile } = req.query;
    const selectedProfile = profileSchema.optional().parse(profile);
    const summary = await getAnalyticsSummary(from as string | undefined, to as string | undefined, selectedProfile);
    return res.status(200).json(newSuccessResponse("Analytics Summary", "Summary metrics fetched", summary));
  } catch (error) {
    return res
      .status(400)
      .json(newErrorResponse("Invalid Request", "Could not fetch summary metrics for the given filters"));
  }
}

export async function timeseriesAnalyticsController(req: Request, res: Response) {
  try {
    const { from, to, profile, interval } = req.query;
    const selectedProfile = profileSchema.optional().parse(profile);
    const intervalValue = interval === "hour" ? "hour" : "day";
    const points = await getAnalyticsTimeseries(
      from as string | undefined,
      to as string | undefined,
      selectedProfile,
      intervalValue
    );
    return res.status(200).json(newSuccessResponse("Analytics Timeseries", "Timeseries metrics fetched", points));
  } catch (error) {
    return res
      .status(400)
      .json(newErrorResponse("Invalid Request", "Could not fetch timeseries metrics for the given filters"));
  }
}

export async function topActionsAnalyticsController(req: Request, res: Response) {
  try {
    const { from, to, profile, limit } = req.query;
    const selectedProfile = profileSchema.optional().parse(profile);
    const parsedLimit = Math.min(Number(limit ?? 10), 50);
    const actions = await getTopActions(
      from as string | undefined,
      to as string | undefined,
      selectedProfile,
      Number.isFinite(parsedLimit) ? parsedLimit : 10
    );
    return res.status(200).json(newSuccessResponse("Top Actions", "Top admin actions fetched", actions));
  } catch (error) {
    return res
      .status(400)
      .json(newErrorResponse("Invalid Request", "Could not fetch top action metrics for the given filters"));
  }
}

export async function topApisAnalyticsController(req: Request, res: Response) {
  try {
    const { from, to, profile, limit } = req.query;
    const selectedProfile = profileSchema.optional().parse(profile);
    const parsedLimit = Math.min(Number(limit ?? 10), 50);
    const routes = await getTopApis(
      from as string | undefined,
      to as string | undefined,
      selectedProfile,
      Number.isFinite(parsedLimit) ? parsedLimit : 10
    );
    return res.status(200).json(newSuccessResponse("Top APIs", "Top API metrics fetched", routes));
  } catch (error) {
    return res
      .status(400)
      .json(newErrorResponse("Invalid Request", "Could not fetch top API metrics for the given filters"));
  }
}
