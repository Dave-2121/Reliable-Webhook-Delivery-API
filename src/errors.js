export class ValidationError extends Error {
  constructor(details) {
    super(details.map((d) => d.message).join("; "));
    this.name = "ValidationError";
    this.details = details;
  }
}
