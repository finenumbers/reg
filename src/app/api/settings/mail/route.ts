import { NextResponse } from "next/server";
import { requireApiPermission } from "@/modules/auth/guards";
import { assertSameOrigin } from "@/lib/csrf";
import { getRequestIp } from "@/lib/request-ip";
import { requireSessionUserId } from "@/modules/auth/session";
import { MAIL_PHRASE } from "@/modules/mail/fields";
import { readCappedBody } from "@/modules/mail/body";
import { getMailView, saveMailSettings } from "@/modules/mail/store";

const SAVE_LIMIT = 32 * 1024;

async function sessionUser(
  request: Request,
): Promise<{ userId: string; ip: string | null } | Response> {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;
  try {
    const ip = await getRequestIp();
    return { userId: requireSessionUserId(gate.ctx), ip };
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
}

/** GET /api/settings/mail — masked mail settings. No ciphertext. */
export async function GET() {
  const gate = await requireApiPermission("settings:write");
  if (!gate.ok) return gate.response;
  try {
    requireSessionUserId(gate.ctx);
  } catch {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const mail = await getMailView();
  return NextResponse.json({ mail });
}

/** PUT /api/settings/mail — save the relay. Does not send a letter. */
export async function PUT(request: Request) {
  const actor = await sessionUser(request);
  if (actor instanceof Response) return actor;

  const body = await readCappedBody(request, SAVE_LIMIT);
  if (!body.ok) {
    return NextResponse.json(
      { error: MAIL_PHRASE.large, code: "BAD_REQUEST" },
      { status: 413 },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return NextResponse.json(
      { error: MAIL_PHRASE.shape, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json(
      { error: MAIL_PHRASE.shape, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  const record = parsed as Record<string, unknown>;
  const saved = await saveMailSettings(
    {
      host: record.host,
      port: record.port,
      username: record.username,
      password: record.password,
      from: record.from,
      recipients: record.recipients,
    },
    actor,
  );
  if (!saved.ok) {
    return NextResponse.json(
      { error: saved.error, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }
  return NextResponse.json({ mail: saved.mail });
}
