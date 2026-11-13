import { NextResponse } from "next/server";
import { FreeNumbersQueryError } from "@/modules/free-numbers/query";

export function freeNumbersErrorResponse(error: unknown): Response {
  if (error instanceof FreeNumbersQueryError) {
    return NextResponse.json(
      { error: error.message, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  throw error;
}
