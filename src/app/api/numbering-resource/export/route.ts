import { startTableExport } from "@/modules/table-export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/numbering-resource/export — start the filtered XLSX build. */
export function POST(request: Request) {
  return startTableExport("numbering", request);
}
