import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";

import { numberingSyncActor, numberingSyncJson } from "@/modules/numbering-sync/http";
import { snapshotRunexisLog } from "@/modules/runexis/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/numbering-sync/runexis/log — the current stage log. Session only. */
export async function GET(request: Request) {
  const actor = await numberingSyncActor(request);
  if (!actor.ok) return actor.response;
  const file = await snapshotRunexisLog();
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
      "Content-Disposition": 'attachment; filename="runexis.txt"',
      "Cache-Control": "private, no-store",
    },
  });
}
