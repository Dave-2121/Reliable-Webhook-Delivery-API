// Run with: npm test   (needs MySQL running, see README)
import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { createApp } from "../src/app.js";
import { runMigrations } from "../scripts/migrate.js";
import { startMockServer } from "./mockServer.js";

// Fast delivery settings so tests don't really wait.
const TEST_DELIVERY = { timeoutMs: 200, maxAttempts: 3, retryBaseDelayMs: 0 };

let pool, server, baseUrl, mock;

// ---- helpers ---------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const registerEndpoint = (path, events = ["order.created"]) =>
  api("POST", "/webhook-endpoints", { url: `${mock.url}${path}`, events });

const sendEvent = (eventId, eventType = "order.created") =>
  api("POST", "/events", {
    eventId,
    eventType,
    payload: { orderId: "order_123", amount: 1500 },
  });

async function count(table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return rows[0].n;
}

// ---- setup / teardown ----------------------------------------------------------
before(async () => {
  const config = loadConfig();
  const testDb = {
    ...config.db,
    database: process.env.TEST_DB_NAME || "webhooks_test",
  };
  assert.notEqual(
    testDb.database,
    config.db.database,
    "TEST_DB_NAME must differ from DB_NAME",
  );

  await runMigrations(testDb); // creates the test DB + tables from a clean state
  pool = createPool(testDb);
  mock = await startMockServer();

  const app = createApp({ pool, deliveryConfig: TEST_DELIVERY });
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
  await pool.end();
});

beforeEach(async () => {
  // Empty all tables (children first because of foreign keys) and reset the mock.
  for (const table of [
    "deliveries",
    "events",
    "endpoint_subscriptions",
    "webhook_endpoints",
  ]) {
    await pool.query(`DELETE FROM ${table}`);
  }
  mock.reset();
});

// ---- the 7 required tests ----------------------------------------------------------
describe("A. register endpoint", () => {
  test("1. registers a valid endpoint", async () => {
    const res = await registerEndpoint("/ok", [
      "order.created",
      "order.updated",
    ]);
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    assert.equal(res.body.url, `${mock.url}/ok`);
    assert.deepEqual(res.body.events, ["order.created", "order.updated"]);
    assert.equal(await count("webhook_endpoints"), 1);
    assert.equal(await count("endpoint_subscriptions"), 2);
  });

  test("2. rejects invalid input and names the wrong field", async () => {
    const cases = [
      { body: { url: "not-a-url", events: ["order.created"] }, field: "url" },
      {
        body: { url: "ftp://example.com/x", events: ["order.created"] },
        field: "url",
      },
      {
        body: { url: "https://example.com", events: ["order.exploded"] },
        field: "events",
      },
      { body: { url: "https://example.com", events: [] }, field: "events" },
      { body: { events: ["order.created"] }, field: "url" }, // url missing
      { body: { url: "https://example.com" }, field: "events" }, // events missing
    ];
    for (const { body, field } of cases) {
      const res = await api("POST", "/webhook-endpoints", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(
        res.body.details.some((d) => d.field === field),
        `expected error on "${field}"`,
      );
      assert.ok(
        res.body.error.includes(field),
        "error message should mention the field",
      );
    }
    assert.equal(await count("webhook_endpoints"), 0); // nothing was saved
  });

  test("2b. rejects invalid events", async () => {
    const cases = [
      { body: { eventType: "order.created", payload: {} }, field: "eventId" },
      {
        body: { eventId: "", eventType: "order.created", payload: {} },
        field: "eventId",
      },
      {
        body: { eventId: "e1", eventType: "nope", payload: {} },
        field: "eventType",
      },
      { body: { eventId: "e1", eventType: "order.created" }, field: "payload" },
      {
        body: { eventId: "e1", eventType: "order.created", payload: [1] },
        field: "payload",
      },
    ];
    for (const { body, field } of cases) {
      const res = await api("POST", "/events", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(
        res.body.details.some((d) => d.field === field),
        `expected error on "${field}"`,
      );
    }
    assert.equal(await count("events"), 0);
  });
});

describe("B/C. accept and deliver", () => {
  test("3. accepts an event and delivers it successfully", async () => {
    const endpoint = await registerEndpoint("/ok");
    const res = await sendEvent("evt_1001");

    assert.equal(res.status, 201);
    assert.deepEqual(res.body.deliverySummary, {
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    assert.equal(res.body.deliveries[0].endpointId, endpoint.body.id);
    assert.equal(res.body.deliveries[0].status, "succeeded");
    assert.equal(res.body.deliveries[0].attempts, 1);
    assert.equal(res.body.deliveries[0].lastStatusCode, 200);

    // The customer endpoint received exactly the documented body.
    assert.equal(mock.hits("/ok"), 1);
    assert.deepEqual(mock.bodies("/ok")[0], {
      eventId: "evt_1001",
      eventType: "order.created",
      payload: { orderId: "order_123", amount: 1500 },
    });

    // GET returns the same story.
    const status = await api("GET", "/events/evt_1001");
    assert.equal(status.status, 200);
    assert.equal(status.body.deliveries[0].status, "succeeded");
  });

  test("only endpoints subscribed to the type receive the event", async () => {
    await registerEndpoint("/ok", ["order.created"]);
    await registerEndpoint("/fail", ["payment.failed"]); // different type
    const res = await sendEvent("evt_1", "order.created");
    assert.equal(res.body.deliverySummary.total, 1);
    assert.equal(mock.hits("/fail"), 0);
  });

  test("event with no subscribers is accepted with zero deliveries", async () => {
    const res = await sendEvent("evt_none");
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.deliverySummary, {
      total: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  test("GET unknown eventId returns 404", async () => {
    const res = await api("GET", "/events/does_not_exist");
    assert.equal(res.status, 404);
  });
});

describe("B. duplicates", () => {
  test("4. rejects a duplicate eventId submitted sequentially", async () => {
    await registerEndpoint("/ok");
    const first = await sendEvent("evt_dup");
    const second = await sendEvent("evt_dup");

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(await count("events"), 1);
    assert.equal(await count("deliveries"), 1);
    assert.equal(mock.hits("/ok"), 1); // no second round of deliveries
  });

  test("5. rejects duplicates submitted concurrently (exactly one accepted)", async () => {
    await registerEndpoint("/ok");

    // Fire 10 identical requests at the same time.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => sendEvent("evt_race")),
    );
    const statuses = results.map((r) => r.status);

    assert.equal(
      statuses.filter((s) => s === 201).length,
      1,
      `statuses: ${statuses}`,
    );
    assert.equal(
      statuses.filter((s) => s === 409).length,
      9,
      `statuses: ${statuses}`,
    );
    assert.equal(await count("events"), 1);
    assert.equal(await count("deliveries"), 1);
    assert.equal(mock.hits("/ok"), 1); // delivered once, not ten times
  });

  test("eventIds are case-sensitive", async () => {
    const a = await sendEvent("EVT_1");
    const b = await sendEvent("evt_1");
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
  });
});

describe("D. retries and timeouts", () => {
  test("6. retries a failing endpoint, stops at the limit, status = failed", async () => {
    await registerEndpoint("/fail");
    const res = await sendEvent("evt_fail");

    assert.equal(res.status, 201); // event accepted even though delivery failed
    assert.deepEqual(res.body.deliverySummary, {
      total: 1,
      succeeded: 0,
      failed: 1,
    });
    const d = res.body.deliveries[0];
    assert.equal(d.status, "failed");
    assert.equal(d.attempts, 3);
    assert.equal(d.lastStatusCode, 500);
    assert.equal(d.lastError, "HTTP 500");
    assert.ok(d.completedAt);
    assert.equal(mock.hits("/fail"), 3); // exactly 3 real requests, never more
  });

  test("7. a slow endpoint is a failed attempt via the timeout", async () => {
    await registerEndpoint("/slow");
    const started = Date.now();
    const res = await sendEvent("evt_slow");
    const elapsed = Date.now() - started;

    const d = res.body.deliveries[0];
    assert.equal(d.status, "failed");
    assert.equal(d.attempts, 3);
    assert.equal(d.lastStatusCode, null);
    assert.match(d.lastError, /timeout after 200ms/);
    assert.ok(
      elapsed < 900,
      `should give up after ~3x200ms, took ${elapsed}ms`,
    );
  });

  test("retry that eventually succeeds is recorded as succeeded", async () => {
    await registerEndpoint("/flaky");
    const res = await sendEvent("evt_flaky");
    const d = res.body.deliveries[0];
    assert.equal(d.status, "succeeded");
    assert.equal(d.attempts, 2);
    assert.equal(d.lastStatusCode, 200);
  });

  test("a redirect (3xx) counts as a failed attempt", async () => {
    await registerEndpoint("/redirect");
    const res = await sendEvent("evt_redirect");
    assert.equal(res.body.deliveries[0].status, "failed");
    assert.equal(res.body.deliveries[0].lastStatusCode, 302);
  });

  test("unreachable endpoint (connection refused) fails without crashing", async () => {
    // Grab a free port, then close it again so nobody is listening there.
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closedPort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));

    await api("POST", "/webhook-endpoints", {
      url: `http://127.0.0.1:${closedPort}/nothing-here`,
      events: ["order.created"],
    });
    const res = await sendEvent("evt_refused");
    assert.equal(res.status, 201);
    assert.equal(res.body.deliveries[0].status, "failed");
    assert.match(res.body.deliveries[0].lastError, /ECONNREFUSED/);
  });

  test("one failing/slow endpoint does not block the others", async () => {
    await registerEndpoint("/fail");
    await registerEndpoint("/slow");
    await registerEndpoint("/ok");
    const res = await sendEvent("evt_mixed");

    assert.deepEqual(res.body.deliverySummary, {
      total: 3,
      succeeded: 1,
      failed: 2,
    });
    assert.equal(mock.hits("/ok"), 1);
    assert.equal(mock.hits("/fail"), 3);
  });
});
