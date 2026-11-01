import { NextResponse } from "next/server";
import { DidClientError } from "@/modules/did/client";
import { FreeNumbersQueryError } from "@/modules/free-numbers/query";

/** DID 401 stays 502 here so the REG session is not treated as logged out. */
export function freeNumbersErrorResponse(error: unknown): Response {
  if (error instanceof FreeNumbersQueryError) {
    return NextResponse.json(
      { error: error.message, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  if (error instanceof DidClientError) {
    const status = error.code === "NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  throw error;
}
