import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireVatsUser } from "@/modules/vats/http";
import { changeDomainField, getDomainCard } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ domain: string }> };

const bodySchema = z
  .object({
    field: z.enum(["client", "language"]),
    value: z.string().max(500),
    expected: z.string().max(500).nullable(),
  })
  .strict();

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireVatsUser("vats:read");
  if (!gate.ok) return gate.response;
  const { domain } = await context.params;
  try {
    const result = await getDomainCard(decodeName(domain));
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ card: result.card });
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать домен." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireVatsUser("vats:write");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }
  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
    }
    throw error;
  }

  const { domain } = await context.params;
  try {
    const result = await changeDomainField(
      {
        domain: decodeName(domain),
        field: input.field,
        value: input.value,
        expected: input.expected,
      },
      { userId: gate.userId, ip: await getRequestIp() },
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.card ? { card: result.card } : {}) },
        { status: result.status },
      );
    }
    return NextResponse.json({ card: result.card, sent: result.sent });
  } catch {
    return NextResponse.json({ error: "Не удалось изменить домен." }, { status: 500 });
  }
}
