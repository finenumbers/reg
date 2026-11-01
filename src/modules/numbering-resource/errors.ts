export type NumberingClientCode =
  "TIMEOUT" | "HTTP_ERROR" | "NETWORK" | "RATE_LIMITED" | "BAD_RESPONSE" | "ABORTED";

export class NumberingQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberingQueryError";
  }
}

export class NumberingClientError extends Error {
  constructor(
    public readonly code: NumberingClientCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "NumberingClientError";
  }
}
