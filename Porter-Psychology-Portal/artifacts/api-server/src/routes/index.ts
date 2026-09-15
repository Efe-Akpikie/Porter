import { Router, type IRouter } from "express";
import healthRouter from "./health";
import practiceRouter from "./practice-mysql";

const router: IRouter = Router();

router.use(healthRouter);
router.use(practiceRouter);

export default router;
