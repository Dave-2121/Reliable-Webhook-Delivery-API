import { SUPPORTED_EVENT_TYPES } from "./constants.js";
import { ValidationError } from "./errors.js";

const MAX_URL_LENGTH = 2048;
const MAX_EVENT_ID_LENGTH = 255;

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const isPlainObject = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validateEndpointInput(body) {
  const { url, events } = body ?? {};
  const details = [];

  if (typeof url !== "string" || url.trim() === "") {
    details.push({
      field: "url",
      message: "url is required and must be a non-empty string",
    });
  } else if (url.trim().length > MAX_URL_LENGTH) {
    details.push({
      field: "url",
      message: `url must be at most ${MAX_URL_LENGTH} characters`,
    });
  } else if (!isHttpUrl(url.trim())) {
    details.push({
      field: "url",
      message: "url must be a valid absolute http or https URL",
    });
  }

  if (!Array.isArray(events) || events.length === 0) {
    details.push({
      field: "events",
      message: "events is required and must be a non-empty array",
    });
  } else {
    const unsupported = events.filter(
      (e) => !SUPPORTED_EVENT_TYPES.includes(e),
    );
    if (unsupported.length > 0) {
      details.push({
        field: "events",
        message:
          `events contains unsupported type(s): ${unsupported.map(String).join(", ")}. ` +
          `Supported: ${SUPPORTED_EVENT_TYPES.join(", ")}`,
      });
    }
  }

  if (details.length > 0) throw new ValidationError(details);

  return { url: url.trim(), events: [...new Set(events)] };
}

export function validateEventInput(body) {
  const { eventId, eventType, payload } = body ?? {};
  const details = [];

  if (typeof eventId !== "string" || eventId.trim() === "") {
    details.push({
      field: "eventId",
      message: "eventId is required and must be a non-empty string",
    });
  } else if (eventId.length > MAX_EVENT_ID_LENGTH) {
    details.push({
      field: "eventId",
      message: `eventId must be at most ${MAX_EVENT_ID_LENGTH} characters`,
    });
  }

  if (
    typeof eventType !== "string" ||
    !SUPPORTED_EVENT_TYPES.includes(eventType)
  ) {
    details.push({
      field: "eventType",
      message: `eventType is required and must be one of: ${SUPPORTED_EVENT_TYPES.join(", ")}`,
    });
  }

  if (!isPlainObject(payload)) {
    details.push({
      field: "payload",
      message: "payload is required and must be a JSON object",
    });
  }

  if (details.length > 0) throw new ValidationError(details);
  return { eventId, eventType, payload };
}
