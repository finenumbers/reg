import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireVatsUser } from "@/modules/vats/http";
import { getVatsSettings, saveVatsSettings } from "@/modules/vats/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    baseUrl: z.string().max(2048),
    login: z.string().max(200),
    password: z.string().max(500).optional(),
  })
  .strict();

export async function GET() {
  const gate = await requireVatsUser("vats:write");
  if (!gate.ok) return gate.response;
  const settings = await getVatsSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
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
      return NextResponse.json({ error: "Проверьте хост, логин и пароль." }, { status: 400 });
    }
    throw error;
  }

  try {
    const result = await saveVatsSettings(input, {
      userId: gate.userId,
      ip: await getRequestIp(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ settings: result.settings });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить настройки." }, { status: 500 });
  }
}
