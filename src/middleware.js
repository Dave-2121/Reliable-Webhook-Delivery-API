import { ValidationError } from "./errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, details: err.details });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
}
