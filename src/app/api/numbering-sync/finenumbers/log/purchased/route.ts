import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";

import { snapshotFinenumbersLog } from "@/modules/finenumbers/log";
import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/numbering-sync/finenumbers/log/purchased — the purchased stage log. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const file = await snapshotFinenumbersLog("purchased");
  if (!file) return numberingSyncJson({ error: "Журнал ещё не создан." }, 404);
  const nodeStream = createReadStream(file);
  nodeStream.on("close", () => {
    void unlink(file).catch(() => undefined);
  });
  nodeStream.on("error", () => {
    void unlink(file).catch(() => undefined);
  });
  const body = Readable.toWeb(nodeStream) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="finenumbers-purchased.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
