import { NextResponse } from "next/server";
import {
  NumberingClientError,
  NumberingQueryError,
} from "@/modules/numbering-resource/errors";

const PRIVATE = { "Cache-Control": "private, no-store" };

export function numberingJson(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: PRIVATE });
}

/** PSTN 401/403 stays 502 here so the REG session is not treated as logged out. */
export function numberingErrorResponse(error: unknown): Response {
  if (error instanceof NumberingQueryError) {
    return NextResponse.json(
      { error: error.message, code: "BAD_REQUEST" },
      { status: 400, headers: PRIVATE },
    );
  }
  if (error instanceof NumberingClientError) {
    if (error.code === "ABORTED") {
      return new NextResponse(null, { status: 499 });
    }
    const status =
      error.code === "RATE_LIMITED"
        ? 429
        : error.code === "HTTP_ERROR" && error.httpStatus === 400
          ? 400
          : 502;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status, headers: PRIVATE },
    );
  }
  throw error;
}
