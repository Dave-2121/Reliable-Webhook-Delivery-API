export const SUPPORTED_EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.cancelled",
  "payment.succeeded",
  "payment.failed",
];

export const DELIVERY_STATUS = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
};

export const DUPLICATE_EVENT_STATUS = 409;
