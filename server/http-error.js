export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.expose = options.expose ?? status < 500;
  }
}

export const asHttpError = (
  error,
  fallbackMessage = "The request could not be completed.",
) => {
  if (error instanceof HttpError) return error;
  return new HttpError(500, "INTERNAL_ERROR", fallbackMessage, {
    cause: error,
  });
};
