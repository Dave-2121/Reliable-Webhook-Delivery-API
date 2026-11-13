import express from "express";
import { createEndpointRoutes } from "./routes/endpointRoutes.js";
import { createEventRoutes } from "./routes/eventRoutes.js";
import { notFoundHandler, errorHandler } from "./middleware.js";

export function createApp({ pool, deliveryConfig }) {
  const app = express();

  app.use(express.json({ limit: "100kb" }));

  app.use("/webhook-endpoints", createEndpointRoutes({ pool }));
  app.use("/events", createEventRoutes({ pool, deliveryConfig }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
