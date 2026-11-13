import { NextResponse } from "next/server";
import { PurchasedNumbersQueryError } from "@/modules/purchased-numbers/query";

export function purchasedNumbersErrorResponse(error: unknown): Response {
  if (error instanceof PurchasedNumbersQueryError) {
    return NextResponse.json(
      { error: error.message, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  throw error;
}
