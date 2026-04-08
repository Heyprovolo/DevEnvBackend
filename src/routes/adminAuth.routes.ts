import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { adminLoginController } from "../controllers/adminAuth.controller.ts";

const adminAuthRouter: ExpressRouter = Router();

adminAuthRouter.post("/login", adminLoginController);

export default adminAuthRouter;

