const IDENTIFIER_MAX = 32;
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

export type IdentifierParse = { ok: true; value: string | null } | { ok: false };

/** Lowercase variable token. Empty is null when the field is optional. */
export function parseIdentifier(raw: string, required: boolean): IdentifierParse {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return required ? { ok: false } : { ok: true, value: null };
  }
  if (trimmed.length > IDENTIFIER_MAX || !IDENTIFIER_RE.test(trimmed)) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

/** Names the unique column from a Prisma P2002 target. */
export function duplicateFieldMessage(target: unknown): string {
  const fields = (Array.isArray(target) ? target : [target])
    .filter((item): item is string => typeof item === "string")
    .join(" ");
  if (fields.includes("identifier")) return "Такой идентификатор уже есть";
  if (fields.includes("name")) return "Такое название уже есть";
  if (fields.includes("ip") || fields.includes("pkey")) return "Такой IP уже есть";
  return "Такой IP, название или идентификатор уже есть";
}

/** Journal devices stay address and name. The identifier is not a folder. */
export function syslogNodeLabels<T extends { ip: string; name: string }>(
  nodes: T[],
): { ip: string; name: string }[] {
  return nodes.map(({ ip, name }) => ({ ip, name }));
}
