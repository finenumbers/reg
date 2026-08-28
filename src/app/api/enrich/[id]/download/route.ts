import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { assertJobOwner } from "@/modules/enrich/jobs";
import { enrichOutputPath, enrichedDownloadName } from "@/modules/enrich/paths";
import {
  XLSX_CONTENT_TYPE,
  xlsxContentDisposition,
} from "@/lib/xlsx-export";

export const runtime = "nodejs";

/**
 * GET /api/enrich/:id/download — stream completed XLSX.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  let userId: string;
  try {
    userId = requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const job = await assertJobOwner(id, userId);
  if (!job) {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  if (job.status !== "completed") {
    return NextResponse.json(
      { error: "Файл ещё не готов", code: "NOT_READY" },
      { status: 409 },
    );
  }

  const filePath = enrichOutputPath(id);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json(
      { error: "Файл недоступен (истёк срок хранения)", code: "GONE" },
      { status: 410 },
    );
  }

  const filename =
    job.summary?.outputFilename ?? enrichedDownloadName(job.sourceFilename);
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": xlsxContentDisposition(filename),
      "Content-Length": String(fileStat.size),
      "Cache-Control": "no-store",
    },
  });
}
