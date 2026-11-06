/**
 * Session-only HTTP for the catalog XLSX builds.
 */

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/csrf";
import { formatExportTimestamp } from "@/lib/format-display-time";
import { getRequestIp } from "@/lib/request-ip";
import { tableExportStartRateLimiter } from "@/lib/rate-limit";
import { XLSX_CONTENT_TYPE, xlsxContentDisposition } from "@/lib/xlsx-export";
import { requireApiPermission } from "@/modules/auth/guards";
import { requireSessionUserId } from "@/modules/auth/session";
import { getDisplayTimezone } from "@/modules/settings";
import { executeTableExport } from "@/modules/table-export/execute";
import {
  beginTableExportJob,
  cancelTableExportJob,
  readActiveTableExportJob,
  readTableExportFile,
  readTableExportJob,
  type TableExportKind,
} from "@/modules/table-export/job";
import {
  parseTableExportRequest,
  TableExportRequestError,
} from "@/modules/table-export/request";

const PRIVATE = { "Cache-Control": "private, no-store" };

const FILE_PREFIX: Record<TableExportKind, string> = {
  free: "free-numbers",
  numbering: "numbering-resource",
};

async function sessionUser(request: Request, mutating: boolean) {
  if (mutating) {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return { ok: false as const, response: origin.response };
  }
  const gate = await requireApiPermission("phones:read");
  if (!gate.ok) return { ok: false as const, response: gate.response };
  try {
    return { ok: true as const, userId: requireSessionUserId(gate.ctx) };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403, headers: PRIVATE },
      ),
    };
  }
}

export async function startTableExport(
  kind: TableExportKind,
  request: Request,
): Promise<NextResponse> {
  const auth = await sessionUser(request, true);
  if (!auth.ok) return auth.response;

  const limited = tableExportStartRateLimiter.check(`table-export:${auth.userId}`);
  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "Слишком много запусков выгрузки — подождите",
        code: "RATE_LIMITED",
        retryAfterSec: limited.retryAfterSec,
      },
      {
        status: 429,
        headers: { ...PRIVATE, "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  let parsed;
  try {
    parsed = parseTableExportRequest(kind, body);
  } catch (error) {
    const message =
      error instanceof TableExportRequestError ? error.message : "Некорректный запрос";
    return NextResponse.json(
      { error: message, code: "BAD_REQUEST" },
      { status: 400, headers: PRIVATE },
    );
  }

  const timeZone = await getDisplayTimezone();
  const filename = `${FILE_PREFIX[kind]}-${formatExportTimestamp(new Date(), timeZone)}.xlsx`;
  const started = beginTableExportJob(
    {
      actorUserId: auth.userId,
      clientIp: await getRequestIp(),
      filename,
      request: parsed,
    },
    executeTableExport,
  );
  if (started === "busy") {
    return NextResponse.json(
      { error: "Дождитесь окончания выгрузки", code: "CONFLICT" },
      { status: 409, headers: PRIVATE },
    );
  }
  return NextResponse.json({ job: started }, { headers: PRIVATE });
}

export async function activeTableExport(
  kind: TableExportKind,
  request: Request,
): Promise<NextResponse> {
  const auth = await sessionUser(request, false);
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { job: readActiveTableExportJob(kind, auth.userId) },
    { headers: PRIVATE },
  );
}

export async function statusTableExport(
  kind: TableExportKind,
  request: Request,
  id: string,
): Promise<NextResponse> {
  const auth = await sessionUser(request, false);
  if (!auth.ok) return auth.response;
  const job = readTableExportJob(kind, id, auth.userId);
  if (!job) {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404, headers: PRIVATE },
    );
  }
  return NextResponse.json({ job }, { headers: PRIVATE });
}

export async function downloadTableExport(
  kind: TableExportKind,
  request: Request,
  id: string,
): Promise<NextResponse> {
  const auth = await sessionUser(request, false);
  if (!auth.ok) return auth.response;
  const file = readTableExportFile(kind, id, auth.userId);
  if (!file) {
    return NextResponse.json(
      { error: "Файл ещё не готов", code: "NOT_FOUND" },
      { status: 404, headers: PRIVATE },
    );
  }
  const nodeStream = createReadStream(file.filePath);
  return new NextResponse(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": xlsxContentDisposition(file.filename),
      "Cache-Control": "no-store",
    },
  });
}

export async function cancelTableExport(
  kind: TableExportKind,
  request: Request,
  id: string,
): Promise<NextResponse> {
  const auth = await sessionUser(request, true);
  if (!auth.ok) return auth.response;
  const result = cancelTableExportJob(kind, id, auth.userId);
  if (result === "missing") {
    return NextResponse.json(
      { error: "Задача не найдена", code: "NOT_FOUND" },
      { status: 404, headers: PRIVATE },
    );
  }
  return NextResponse.json({ ok: true, result }, { headers: PRIVATE });
}
