// A tiny local HTTP server that pretends to be a customer's webhook endpoint.
// Tests never talk to the real internet.
import http from "node:http";

export async function startMockServer() {
  const received = {}; // path -> [parsed request bodies]
  const counters = {}; // path -> how many requests so far (used by /flaky)

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = req.url;
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "null");
      } catch {
        /* ignore bad JSON */
      }
      (received[path] ??= []).push(body);
      counters[path] = (counters[path] ?? 0) + 1;

      if (path === "/ok") {
        res.writeHead(200).end("ok"); // success
      } else if (path === "/fail") {
        res.writeHead(500).end("boom"); // always fails
      } else if (path === "/flaky") {
        // fails the first time, succeeds afterwards
        res.writeHead(counters[path] === 1 ? 500 : 200).end();
      } else if (path === "/redirect") {
        res.writeHead(302, { Location: "/ok" }).end(); // 3xx must count as failure
      } else if (path === "/slow") {
        // answers only after 1s, i.e. longer than the test timeout
        const timer = setTimeout(() => res.writeHead(200).end("late"), 1000);
        res.on("close", () => clearTimeout(timer));
      } else {
        res.writeHead(404).end();
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); // port 0 = any free port
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    hits: (path) => (received[path] ?? []).length,
    bodies: (path) => received[path] ?? [],
    reset() {
      for (const key of Object.keys(received)) delete received[key];
      for (const key of Object.keys(counters)) delete counters[key];
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
