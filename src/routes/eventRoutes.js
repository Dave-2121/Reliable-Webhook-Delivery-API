import { Router } from "express";
import { DUPLICATE_EVENT_STATUS } from "../constants.js";
import { validateEventInput } from "../validators.js";
import {
  acceptEvent,
  getEventWithDeliveries,
  summarizeDeliveries,
} from "../services/eventService.js";
import { deliverToAll } from "../services/deliveryService.js";

export function createEventRoutes({ pool, deliveryConfig }) {
  const router = Router();

  router.post("/", async (req, res) => {
    const event = validateEventInput(req.body);

    const accepted = await acceptEvent(pool, event);
    if (accepted.duplicate) {
      return res.status(DUPLICATE_EVENT_STATUS).json({
        error: `eventId "${event.eventId}" was already accepted`,
        statusUrl: `/events/${encodeURIComponent(event.eventId)}`,
      });
    }

    await deliverToAll(pool, accepted.deliveries, event, deliveryConfig);

    const saved = await getEventWithDeliveries(pool, event.eventId);
    res
      .status(201)
      .json({
        ...saved,
        deliverySummary: summarizeDeliveries(saved.deliveries),
      });
  });

  router.get("/:eventId", async (req, res) => {
    const saved = await getEventWithDeliveries(pool, req.params.eventId);
    if (!saved) {
      return res
        .status(404)
        .json({ error: `Event "${req.params.eventId}" not found` });
    }
    res.json({
      ...saved,
      deliverySummary: summarizeDeliveries(saved.deliveries),
    });
  });

  return router;
}
