import { createApp } from "./app.js";
import { config } from "./config.js";
import { logError, logInfo } from "./logger.js";

const app = await createApp();

app.listen({ host: "0.0.0.0", port: config.port }).catch((error) => {
  logError("SERVER_START_FAILED", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

logInfo("SERVER_STARTED", {
  port: config.port,
  appUrl: config.appUrl,
  trustProxy: config.trustProxy
});
