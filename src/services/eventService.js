import { DELIVERY_STATUS } from "../constants.js";

function parsePayload(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function acceptEvent(pool, { eventId, eventType, payload }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const now = new Date();

    let eventPk;
    try {
      const [result] = await connection.execute(
        "INSERT INTO events (event_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
        [eventId, eventType, JSON.stringify(payload), now],
      );
      eventPk = result.insertId;
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        await connection.rollback();
        return { duplicate: true };
      }
      throw err;
    }

    const [endpoints] = await connection.execute(
      `SELECT e.id, e.url
         FROM endpoint_subscriptions s
         JOIN webhook_endpoints e ON e.id = s.endpoint_id
        WHERE s.event_type = ?
        ORDER BY e.id`,
      [eventType],
    );

    const deliveries = [];
    for (const endpoint of endpoints) {
      const [result] = await connection.execute(
        "INSERT INTO deliveries (event_pk, endpoint_id, status, attempts, created_at) VALUES (?, ?, ?, 0, ?)",
        [eventPk, endpoint.id, DELIVERY_STATUS.PENDING, now],
      );
      deliveries.push({
        id: result.insertId,
        endpointId: endpoint.id,
        url: endpoint.url,
      });
    }

    await connection.commit();
    return { duplicate: false, deliveries };
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}

export async function getEventWithDeliveries(pool, eventId) {
  const [events] = await pool.execute(
    "SELECT id, event_id, event_type, payload, created_at FROM events WHERE event_id = ?",
    [eventId],
  );
  if (events.length === 0) return null;
  const event = events[0];

  const [rows] = await pool.execute(
    `SELECT d.endpoint_id, e.url, d.status, d.attempts, d.last_status_code,
            d.last_error, d.created_at, d.last_attempt_at, d.completed_at
       FROM deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.event_pk = ?
      ORDER BY d.endpoint_id`,
    [event.id],
  );

  return {
    eventId: event.event_id,
    eventType: event.event_type,
    payload: parsePayload(event.payload),
    createdAt: event.created_at,
    deliveries: rows.map((row) => ({
      endpointId: row.endpoint_id,
      url: row.url,
      status: row.status,
      attempts: row.attempts,
      lastStatusCode: row.last_status_code,
      lastError: row.last_error,
      createdAt: row.created_at,
      lastAttemptAt: row.last_attempt_at,
      completedAt: row.completed_at,
    })),
  };
}

export function summarizeDeliveries(deliveries) {
  return {
    total: deliveries.length,
    succeeded: deliveries.filter((d) => d.status === DELIVERY_STATUS.SUCCEEDED)
      .length,
    failed: deliveries.filter((d) => d.status === DELIVERY_STATUS.FAILED)
      .length,
  };
}
