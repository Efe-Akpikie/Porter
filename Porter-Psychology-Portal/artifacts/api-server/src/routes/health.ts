import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { query } from "../lib/mysql";

const router: IRouter = Router();

router.get("/healthz", async (_req, res, next) => {
  try {
    await query("SELECT 1");
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
