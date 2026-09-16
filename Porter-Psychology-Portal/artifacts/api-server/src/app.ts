import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { stripeWebhook } from "./lib/payments";

const app: Express = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

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
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || undefined,
    credentials: true,
  }),
);
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook,
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const publicDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../porter-psychology/dist/public",
  );
  const indexFile = path.join(publicDirectory, "index.html");

  if (!existsSync(indexFile)) {
    throw new Error(
      `Frontend build was not found at ${indexFile}. Run the workspace build before starting the server.`,
    );
  }

  app.use(express.static(publicDirectory, { index: false, maxAge: "1h" }));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(indexFile);
      return;
    }
    next();
  });
}

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
      "name" in error &&
      error.name === "ZodError" &&
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
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      response
        .status(409)
        .json({ error: "A conflicting record already exists" });
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["ER_NO_REFERENCED_ROW", "ER_NO_REFERENCED_ROW_2"].includes(
        String(error.code),
      )
    ) {
      response.status(400).json({ error: "A related record does not exist" });
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      (error.code.startsWith("ER_") ||
        ["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"].includes(
          error.code,
        ))
    ) {
      logger.error({ error }, "Database request failed");
      response.status(503).json({ error: "Database temporarily unavailable" });
      return;
    }
    logger.error({ error }, "Unhandled request error");
    response.status(500).json({ error: "Internal server error" });
  },
);

export default app;
