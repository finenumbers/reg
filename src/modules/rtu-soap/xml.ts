const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The five built-in XML entities. External and numeric references stay literal. */
export function decodeXmlText(value: string): string {
  return value.replaceAll(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    const name = entity.slice(1, -1);
    return NAMED[name] ?? entity;
  });
}

export function hasDoctype(xml: string): boolean {
  return /<!DOCTYPE/i.test(xml);
}

export function isXmlName(value: string): boolean {
  return XML_NAME.test(value);
}

export function redactSecret(text: string, secret: string): string {
  const decoded = decodeXmlText(text);
  const cleaned = secret.length > 0 ? decoded.split(secret).join("[REDACTED]") : decoded;
  return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned;
}
