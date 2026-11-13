import "dotenv/config";

function intFromEnv(name, defaultValue, min = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min} (got "${raw}")`);
  }
  return value;
}

export function loadConfig() {
  return {
    port: intFromEnv("PORT", 3000, 1),
    db: {
      host: process.env.DB_HOST || "127.0.0.1",
      port: intFromEnv("DB_PORT", 3306, 1),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD ?? "rootpassword",
      database: process.env.DB_NAME || "webhooks",
    },
    delivery: {
      timeoutMs: intFromEnv("DELIVERY_TIMEOUT_MS", 5000, 1),
      maxAttempts: intFromEnv("DELIVERY_MAX_ATTEMPTS", 3, 1),
      retryBaseDelayMs: intFromEnv("DELIVERY_RETRY_BASE_DELAY_MS", 500, 0),
    },
  };
}
