export async function createEndpoint(pool, { url, events }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const createdAt = new Date();

    const [result] = await connection.execute(
      "INSERT INTO webhook_endpoints (url, created_at) VALUES (?, ?)",
      [url, createdAt],
    );
    const endpointId = result.insertId;

    for (const eventType of events) {
      await connection.execute(
        "INSERT INTO endpoint_subscriptions (endpoint_id, event_type) VALUES (?, ?)",
        [endpointId, eventType],
      );
    }

    await connection.commit();
    return { id: endpointId, url, events, createdAt };
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}
