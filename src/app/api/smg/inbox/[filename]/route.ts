import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { openPoisonedSmgFile } from "@/modules/smg/inbox";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ filename: string }> };

/**
 * GET /api/smg/inbox/:filename — stream a CDR the import journal held back.
 */
export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return gate.response;

  const { filename } = await context.params;
  const file = await openPoisonedSmgFile(filename);
  if (!file) {
    return NextResponse.json(
      { error: "Файл не найден", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const nodeStream = createReadStream(file.absPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
    },
  });
}
