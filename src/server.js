import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.db);
const app = createApp({ pool, deliveryConfig: config.delivery });

const server = app.listen(config.port, () => {
  console.log(`Webhook API listening on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.addListener("SIGBREAK", () => {
  process.kill(0);
});
