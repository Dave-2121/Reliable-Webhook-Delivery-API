# Reliable Webhook Delivery API

A small backend where customers register webhook endpoints and submit events. Each accepted
event is delivered (inside the request) to every subscribed endpoint, with a timeout and a
bounded number of retries. Duplicate events are rejected by the database, even under
concurrent requests.

**Stack:** Node.js (>= 20), Express 5, MySQL 8, plain JavaScript (ES modules).
**Dependencies:** `express`, `mysql2`, `dotenv`. Tests use only Node's built-in test runner.

---

## 1. Setup

```bash
# 1. Start MySQL (or use your own MySQL 8 and edit .env)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure (optional: every value has the same default in src/config.js)
cp .env.example .env

# 4. Create the database and tables from a clean state
npm run migrate

# 5. Run the API
npm start            # http://localhost:3000
# npm run dev        # same, but restarts on file changes
```

### Run the tests

```bash
npm test
```

Needs MySQL running (step 1). Tests create and use a **separate** database (`webhooks_test`),
start a local mock HTTP server, and never call real external URLs. The test run applies the
SQL migration itself, so it also works on a completely empty MySQL server.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port of the API |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL location |
| `DB_USER` / `DB_PASSWORD` | `root` / `rootpassword` | MySQL credentials |
| `DB_NAME` | `webhooks` | Database used by the app |
| `TEST_DB_NAME` | `webhooks_test` | Database used by tests (must differ from `DB_NAME`) |
| `DELIVERY_TIMEOUT_MS` | `5000` | Timeout of **each** delivery attempt |
| `DELIVERY_MAX_ATTEMPTS` | `3` | Max attempts per endpoint (1 initial + 2 retries) |
| `DELIVERY_RETRY_BASE_DELAY_MS` | `500` | Base delay for exponential backoff (`0` = no waiting) |

---

## 2. API

### `POST /webhook-endpoints`
```json
{ "url": "https://example.com/webhook", "events": ["order.created", "order.updated"] }
```
- `201` -> `{ "id": 1, "url": "...", "events": [...], "createdAt": "..." }`
- `400` -> `{ "error": "url must be a valid absolute http or https URL", "details": [{ "field": "url", "message": "..." }] }`

### `POST /events`
```json
{ "eventId": "evt_1001", "eventType": "order.created", "payload": { "orderId": "order_123", "amount": 1500 } }
```
- `201` -> event + final delivery result per endpoint + `deliverySummary` (see "Response choices")
- `409` -> `eventId` was already accepted (duplicate)
- `400` -> validation error (names the wrong field)

### `GET /events/:eventId`
- `200` -> event, `deliverySummary`, and one delivery record per endpoint
  (`endpointId`, `url`, `status`, `attempts`, `lastStatusCode`, `lastError`, timestamps)
- `404` -> unknown `eventId`

Delivery `status` is `pending` (in progress), `succeeded`, or `failed` (attempts exhausted).

### Try it by hand
```bash
curl -XPOST localhost:3000/webhook-endpoints -H 'content-type: application/json' \
  -d '{"url":"https://example.com/webhook","events":["order.created"]}'

curl -XPOST localhost:3000/events -H 'content-type: application/json' \
  -d '{"eventId":"evt_1001","eventType":"order.created","payload":{"orderId":"order_123","amount":1500}}'

curl localhost:3000/events/evt_1001
```

---

## 3. How it works (short version)

`POST /events` does this, in order:

1. **Validate** the body (`400` if wrong).
2. **One DB transaction:** insert the event, find subscribed endpoints, insert one `pending`
   delivery row per endpoint. If the `eventId` already exists, MySQL's UNIQUE index raises
   `ER_DUP_ENTRY` -> the transaction is rolled back and the API answers `409`.
3. **Deliver** to all endpoints **in parallel** (`Promise.all`); each endpoint has its own
   bounded retry loop. After every attempt the delivery row is updated in the database.
4. **Respond** with `201` and the final delivery results read back from the database.

Code map: `routes/` (HTTP) -> `services/` (logic + SQL) -> MySQL. `validators.js` checks input,
`middleware.js` turns every error into a JSON response, `config.js` reads the environment.

---

## 4. Design decisions

### Retry strategy: exponential backoff, max 3 attempts
Attempt 1 immediately; if it fails wait `base` (500 ms), attempt 2; if it fails wait
`2 x base` (1000 ms), attempt 3; then stop and mark `failed`.

Why: a failing endpoint is often briefly overloaded or restarting. Waiting a little, and a bit
longer each time, gives it room to recover instead of hammering it. It stays simple (one
formula) and the total waiting time is small because the delivery happens inside the HTTP
request. The loop is a plain `for` from 1 to `maxAttempts`, so an infinite loop is impossible.
Delay and attempts come from config; tests set the delay to `0` so nothing really waits.

Worst case for one request: `3 x 5 s` (timeouts) + `0.5 s + 1 s` (waits) = **16.5 seconds**.
Endpoints are delivered in parallel, so more endpoints do not add up.

What counts as an attempt: any 2xx = success. Any other status (including 3xx - redirects are
**not** followed), a network error (e.g. connection refused, DNS failure) or a timeout = failed
attempt. All failed attempts are retried (we do not distinguish 4xx from 5xx; see limitations).

### Response when an `eventId` is a duplicate: `409 Conflict`
The event already exists, so this request was *not* accepted. `409` says that clearly and
makes "exactly one request is accepted" visible to the caller (one `201`, the rest `409`).
The body contains a `statusUrl` (`/events/<eventId>`) so the caller can look up what happened
to the original. Nothing is inserted and nothing is delivered again.
(Alternative: `200` with the existing event, which is friendlier to blind client retries. It is
a one-line change: `DUPLICATE_EVENT_STATUS` in `src/constants.js`.)

### Response when the event is accepted but deliveries fail: `201 Created`
The API's job is to *accept and record* the event; that succeeded, so the answer is `201`
whether 0, some or all deliveries failed. A failing **customer** endpoint is not a failure of
the **producer's** request, and returning `5xx` would make producers retry, which would then
be rejected as duplicates. The truth is in the body: `deliverySummary`
(`{ total, succeeded, failed }`) and one record per endpoint with its final status and last
error. The same data is available later via `GET /events/:eventId`.
(`500` is returned only for real internal errors, e.g. the database is down.)

### Database design (see `sql/001_schema.sql`)
- `webhook_endpoints` - the endpoints.
- `endpoint_subscriptions` - (endpoint, event type) pairs. Primary key `(endpoint_id, event_type)`
  stops double subscriptions. Index `(event_type, endpoint_id)` makes "who subscribes to type X"
  an index-only lookup (verified with `EXPLAIN`: `Using index`).
- `events` - **`UNIQUE KEY (event_id)`** is the duplicate guard. It lives in the database, so it
  holds even with many app instances and simultaneous requests. `event_id` uses the
  case-sensitive `utf8mb4_bin` collation, so `EVT_1` and `evt_1` are different ids.
- `deliveries` - one row per (event, endpoint): `UNIQUE (event_pk, endpoint_id)` and foreign keys
  to exactly one event and one endpoint. Stores `status`, `attempts`, `last_status_code`,
  `last_error`, `created_at`, `last_attempt_at`, `completed_at`.

---

## 5. Known limitations

- **Crash mid-delivery:** the event and its `pending` delivery rows are committed *before*
  delivering, and each attempt is saved as it happens. If the process dies mid-delivery, the
  event stays accepted and the unfinished deliveries stay `pending` with the attempts made so
  far. Nothing resumes them automatically (no worker/scheduler is allowed by the brief), and
  a client resubmitting the same `eventId` gets `409`. A real system would add a recovery job
  that re-delivers old `pending` rows. A crash *between* the HTTP call and the database update
  can also cause one extra delivery later - delivery is **at-least-once**, so receivers should
  de-duplicate using `eventId`.
- **Slow requests:** the caller waits for all retries (up to ~16.5 s with defaults). If the
  caller disconnects meanwhile, delivery still finishes (the server keeps working).
- **No concurrency cap:** all endpoints of one event are called at once. With thousands of
  subscribers a limit (e.g. 20 at a time) would be needed.
- **All failures are retried**, including `4xx` (such as 404 or 410) that are unlikely to ever succeed.
- **No SSRF protection:** a customer can register `http://localhost/...` or private IPs. Fine for
  this exercise (the tests rely on `127.0.0.1`); production needs an allow/deny list.
- MySQL's `JSON` type normalises key order in stored payloads, so `GET` may show the keys in a
  different order than sent. The body delivered to endpoints is the original, untouched JSON.

## 6. Not finished / future work

Everything required is implemented and tested. Out of scope per the brief and not built:
authentication, webhook signing (HMAC header), pagination, a UI. Ideas for later: recovery job
for stale `pending` deliveries, per-attempt history table, `Retry-After` support, skipping
retries on permanent `4xx`, a concurrency limit, request logging and metrics.
