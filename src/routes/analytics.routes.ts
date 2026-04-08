import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  ingestAnalyticsController,
  summaryAnalyticsController,
  timeseriesAnalyticsController,
  topActionsAnalyticsController,
  topApisAnalyticsController,
} from "../controllers/analytics.controller.ts";
import {
  backendAlertsController,
  backendDashboardController,
  backendSchemaController,
} from "../controllers/observability.controller.ts";
import {
  analyticsOptimizationController,
  analyticsOverviewController,
  analyticsProposalsController,
  analyticsResumesController,
  analyticsUsersController,
} from "../controllers/analyticsInsights.controller.ts";
import { adminAuthMiddleware } from "../middlewares/adminAuth.middleware.ts";

const analyticsRouter: ExpressRouter = Router();

const ingestLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

analyticsRouter.use(adminAuthMiddleware);
analyticsRouter.post("/events", ingestLimiter, ingestAnalyticsController);
analyticsRouter.get("/summary", summaryAnalyticsController);
analyticsRouter.get("/timeseries", timeseriesAnalyticsController);
analyticsRouter.get("/actions/top", topActionsAnalyticsController);
analyticsRouter.get("/apis/top", topApisAnalyticsController);
analyticsRouter.get("/backend/dashboard", backendDashboardController);
analyticsRouter.get("/backend/alerts", backendAlertsController);
analyticsRouter.get("/backend/schema", backendSchemaController);
analyticsRouter.get("/overview", analyticsOverviewController);
analyticsRouter.get("/users", analyticsUsersController);
analyticsRouter.get("/proposals", analyticsProposalsController);
analyticsRouter.get("/optimization", analyticsOptimizationController);
analyticsRouter.get("/resumes", analyticsResumesController);

export default analyticsRouter;
