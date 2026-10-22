import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { readSmgExportJob, takeSmgExportFile } from "@/modules/smg/export-job";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/smg/export/:id/download — the finished file. Removed after the stream closes. */
export async function GET(_request: Request, context: RouteContext) {
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
  if (!readSmgExportJob(id, userId)) {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  const taken = takeSmgExportFile(id, userId);
  if (!taken) {
    return NextResponse.json(
      { error: "Файл ещё не готов", code: "CONFLICT" },
      { status: 409 },
    );
  }
  const nodeStream = createReadStream(taken.filePath);
  const cleanup = () => {
    void rm(taken.dir, { recursive: true, force: true });
  };
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);
  return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": xlsxContentDisposition(taken.filename),
      "Cache-Control": "no-store",
    },
  });
}
