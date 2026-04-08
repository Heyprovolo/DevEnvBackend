import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import healthRoutes from "./health.routes.ts";
import authRoutes from "./auth.routes.ts";
import aiRouter from "./ai.routes.ts";
import paymentRouter from "./payment.routes.ts";
import supportRouter from "./support.routes.ts";
import notificationRouter from "./notification.route.ts";
import resumeRouter from "./resume.routes.ts";
import latexRouter from "./latex.routes.ts";
import analyticsRouter from "./analytics.routes.ts";
import adminAuthRouter from "./adminAuth.routes.ts";
import knowledgeBaseRouter from "./knowledgeBase.routes.ts";

const v1Routes: ExpressRouter = Router();
v1Routes.use("/auth", authRoutes);
v1Routes.use("/health", healthRoutes);
v1Routes.use("/ai", aiRouter);
v1Routes.use("/payment", paymentRouter);
v1Routes.use("/support", supportRouter);
v1Routes.use("/notifications", notificationRouter);
v1Routes.use("/resumes", resumeRouter);
v1Routes.use("/latex", latexRouter);
v1Routes.use("/analytics", analyticsRouter);
v1Routes.use("/admin-auth", adminAuthRouter);
v1Routes.use("/knowledge-base", knowledgeBaseRouter);

export default v1Routes;
