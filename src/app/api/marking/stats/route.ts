import { NextResponse } from "next/server";
import {
  isMarkingStatsStatementTimeout,
  listMarkingStats,
  MarkingStatsError,
} from "@/modules/marking/stats";
import { requireTariffSession } from "@/modules/tariffs/guard";

/**
 * GET /api/marking/stats?month=YYYY-MM — client totals for one OPRS month.
 * Session + phones:read. API keys are rejected. A missing month is the current one.
 */
export async function GET(request: Request) {
  const gate = await requireTariffSession();
  if (!gate.ok) return gate.response;

  const month = new URL(request.url).searchParams.get("month");
  try {
    const data = await listMarkingStats(month);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof MarkingStatsError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isMarkingStatsStatementTimeout(error)) {
      return NextResponse.json(
        { error: "Не удалось загрузить статистику маркировки" },
        { status: 503 },
      );
    }
    throw error;
  }
}
