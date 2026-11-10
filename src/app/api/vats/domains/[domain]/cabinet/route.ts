import { getRequestIp } from "@/lib/request-ip";
import {
  CABINET_FAILED,
  CABINET_NAVIGATION,
  cabinetAppHosts,
  cabinetErrorText,
  cabinetNavigation,
} from "@/modules/vats/cabinet";
import { requireVatsUser } from "@/modules/vats/http";
import { openDomainCabinet } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ domain: string }> };

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cabinetHtml(status: number, message: string, domain = ""): Response {
  const text = cabinetErrorText(message, domain);
  const body = `<!doctype html><meta charset="utf-8"><title>Кабинет домена</title><p>${escapeHtml(text)}</p>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  if (!cabinetNavigation(request.headers)) {
    return cabinetHtml(400, CABINET_NAVIGATION);
  }
  const gate = await requireVatsUser("vats:write");
  if (!gate.ok) return gate.response;
  const { domain: raw } = await context.params;
  const domain = decodeName(raw);
  try {
    const result = await openDomainCabinet({
      domain,
      userId: gate.userId,
      ip: await getRequestIp(),
      appHosts: cabinetAppHosts(request),
    });
    if (!result.ok) return cabinetHtml(result.status, result.error, domain);
    return new Response(null, {
      status: 303,
      headers: {
        Location: result.location,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return cabinetHtml(500, CABINET_FAILED, domain);
  }
}
