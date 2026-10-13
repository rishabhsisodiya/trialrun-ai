/** An error the API reports to the browser as-is: status, machine code, human message. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} was not found.`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
