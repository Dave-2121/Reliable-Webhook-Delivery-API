import { DELIVERY_STATUS } from "../constants.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeError(err, timeoutMs) {
  if (err.name === "TimeoutError") return `timeout after ${timeoutMs}ms`;

  const cause = err.cause;
  const reason =
    cause?.code ??
    cause?.errors?.[0]?.code ??
    cause?.message ??
    err.code ??
    err.message;
  return `network error: ${reason}`.slice(0, 500);
}

async function attemptOnce(url, body, timeoutMs) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, statusCode: response.status, error: null };
    }
    return {
      ok: false,
      statusCode: response.status,
      error: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      error: describeError(err, timeoutMs),
    };
  }
}

async function recordAttempt(pool, deliveryId, { attempt, status, outcome }) {
  const now = new Date();
  const isFinal = status !== DELIVERY_STATUS.PENDING;
  await pool.execute(
    `UPDATE deliveries
        SET status = ?, attempts = ?, last_status_code = ?, last_error = ?,
            last_attempt_at = ?, completed_at = ?
      WHERE id = ?`,
    [
      status,
      attempt,
      outcome.statusCode,
      outcome.error,
      now,
      isFinal ? now : null,
      deliveryId,
    ],
  );
}

export async function deliverToEndpoint(pool, delivery, requestBody, config) {
  const { timeoutMs, maxAttempts, retryBaseDelayMs } = config;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const outcome = await attemptOnce(delivery.url, requestBody, timeoutMs);
      const isLastAttempt = attempt === maxAttempts;

      let status = DELIVERY_STATUS.PENDING;
      if (outcome.ok) status = DELIVERY_STATUS.SUCCEEDED;
      else if (isLastAttempt) status = DELIVERY_STATUS.FAILED;

      await recordAttempt(pool, delivery.id, { attempt, status, outcome });

      if (status !== DELIVERY_STATUS.PENDING) return;

      await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
    }
  } catch (err) {
    console.error(
      `Delivery ${delivery.id} to ${delivery.url} aborted:`,
      err.message,
    );
  }
}

export async function deliverToAll(pool, deliveries, event, config) {
  const requestBody = JSON.stringify({
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.payload,
  });

  await Promise.all(
    deliveries.map((d) => deliverToEndpoint(pool, d, requestBody, config)),
  );
}
