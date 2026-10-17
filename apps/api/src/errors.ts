/** An error that maps directly to an HTTP response `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Please sign in");
export const notFound = (what = "Not found") => new HttpError(404, "not_found", what);
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
