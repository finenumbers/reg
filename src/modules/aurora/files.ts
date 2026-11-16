/**
 * Saved Aurora links. The ciphertext is the address. A browser path is never opened.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";
import { isAuroraFormat, type AuroraFormat } from "@/modules/aurora/parse";
import { canonicalizeAuroraUrl } from "@/modules/aurora/url";

export const AURORA_LINK_LIMIT = 20;

export type AuroraLinkRow = {
  id: string;
  url: string;
  host: string;
  format: AuroraFormat;
  sortIndex: number;
  unreadable: boolean;
};

const UNREADABLE = "Ссылка не читается.";

function seal(href: string): string {
  return serializeEncryptedSecret(getSecretEncryptionService().encrypt(href));
}

function openLink(raw: string): { href: string; host: string } | null {
  try {
    const href = getSecretEncryptionService().decrypt(deserializeEncryptedSecret(raw));
    const parsed = canonicalizeAuroraUrl(href);
    if (!parsed.ok || parsed.href !== href) return null;
    return { href: parsed.href, host: parsed.host };
  } catch {
    return null;
  }
}

export async function listAuroraLinks(): Promise<AuroraLinkRow[]> {
  const rows = await prisma.$queryRaw<
    { id: string; url_ciphertext: string; format: string; sort_index: number }[]
  >`
    SELECT id, url_ciphertext, format, sort_index
    FROM aurora_files
    ORDER BY sort_index, id
  `;
  return rows.flatMap((row): AuroraLinkRow[] => {
    if (!isAuroraFormat(row.format)) {
      return [
        {
          id: row.id,
          url: "",
          host: "",
          format: "short",
          sortIndex: row.sort_index,
          unreadable: true,
        },
      ];
    }
    const opened = openLink(row.url_ciphertext);
    if (!opened) {
      return [
        {
          id: row.id,
          url: "",
          host: "",
          format: row.format,
          sortIndex: row.sort_index,
          unreadable: true,
        },
      ];
    }
    return [
      {
        id: row.id,
        url: opened.href,
        host: opened.host,
        format: row.format,
        sortIndex: row.sort_index,
        unreadable: false,
      },
    ];
  });
}

export async function countAuroraLinks(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM aurora_files
  `;
  return rows[0]?.count ?? 0;
}

export function unreadableAuroraLink(): string {
  return UNREADABLE;
}

export async function addAuroraLink(input: {
  url: string;
  format: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAuroraFormat(input.format)) return { ok: false, error: "Укажите формат файла." };
  const parsed = canonicalizeAuroraUrl(input.url);
  if (!parsed.ok) return parsed;
  const existing = await listAuroraLinks();
  if (existing.length >= AURORA_LINK_LIMIT) {
    return { ok: false, error: "Уже сохранено 20 ссылок." };
  }
  if (existing.some((link) => link.url === parsed.href)) {
    return { ok: false, error: "Такая ссылка уже есть." };
  }
  const sortIndex = existing.reduce((max, row) => Math.max(max, row.sortIndex), -1) + 1;
  await prisma.$executeRaw`
    INSERT INTO aurora_files (id, sort_index, url_ciphertext, format)
    VALUES (${randomUUID()}, ${sortIndex}, ${seal(parsed.href)}, ${input.format})
  `;
  return { ok: true };
}

export async function removeAuroraLink(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    DELETE FROM aurora_files WHERE id = ${id} RETURNING id
  `;
  if (rows.length !== 1) return { ok: false, error: "Ссылка уже удалена." };
  return { ok: true };
}

export async function moveAuroraLink(
  id: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const files = await listAuroraLinks();
  const index = files.findIndex((file) => file.id === id);
  if (index < 0) return { ok: false, error: "Ссылка уже удалена." };
  const swap = direction === "up" ? index - 1 : index + 1;
  const current = files[index];
  const other = files[swap];
  if (!current || !other) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE aurora_files SET sort_index = -1 WHERE id = ${current.id}`;
    await tx.$executeRaw`
      UPDATE aurora_files SET sort_index = ${current.sortIndex} WHERE id = ${other.id}
    `;
    await tx.$executeRaw`
      UPDATE aurora_files SET sort_index = ${other.sortIndex} WHERE id = ${current.id}
    `;
  });
  return { ok: true };
}
