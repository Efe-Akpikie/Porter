import app from "./app";
import { logger } from "./lib/logger";
import { initializeDatabase, pool } from "./lib/mysql";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    await initializeDatabase();
  } catch (error) {
    logger.fatal({ error }, "Database startup failed");
    await pool.end();
    process.exit(1);
  }

  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
  server.on("error", (error) => {
    logger.fatal({ error }, "Error listening on port");
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void start();
