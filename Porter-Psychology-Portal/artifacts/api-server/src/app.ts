import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      error &&
      typeof error === "object" &&
      error.constructor.name === "ZodError" &&
      "issues" in error &&
      Array.isArray(error.issues)
    ) {
      response.status(400).json({
        error: "Invalid request",
        issues: error.issues.map(
          (issue: { path?: unknown; message?: unknown }) => ({
            path: issue.path,
            message: issue.message,
          }),
        ),
      });
      return;
    }
    logger.error({ error }, "Unhandled request error");
    response.status(500).json({ error: "Internal server error" });
  },
);

export default app;
