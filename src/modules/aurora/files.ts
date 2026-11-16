/**
 * The inbox of CSV files. A path from the browser is never opened.
 * Files stay until a catalog commit, then the ones that unlinked leave the list.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  combineAuroraFiles,
  decodeAuroraCsv,
  isAuroraFormat,
  type AuroraFileText,
  type AuroraFormat,
  type ParsedAurora,
} from "@/modules/aurora/parse";

export const AURORA_FILE_LIMIT = 20;
export const AURORA_FILE_BYTES = 20 * 1024 * 1024;

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$/;

export type AuroraFileRow = {
  id: string;
  name: string;
  format: AuroraFormat;
};

type StoredRow = AuroraFileRow & { storedName: string; sortIndex: number };

let dirOverride: string | null = null;

export function setAuroraFileDirForTests(dir: string | null): void {
  dirOverride = dir;
}

function directory(): string {
  return dirOverride ?? path.join(process.cwd(), "data", "aurora");
}

export function displayFileName(raw: string): string | null {
  const base = path.basename(raw).replace(/[\u0000-\u001f]/g, "").trim();
  if (!base || base === "." || base === "..") return null;
  if (!base.toLowerCase().endsWith(".csv")) return null;
  return base.slice(0, 120);
}

function storedPath(name: string): string {
  if (!STORED_NAME.test(name)) throw new Error("Файл не найден.");
  const root = path.resolve(directory());
  const full = path.resolve(root, name);
  if (full !== path.join(root, name)) throw new Error("Файл не найден.");
  return full;
}

async function ensureDir(): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
}

function mapRow(row: {
  id: string;
  display_name: string;
  format: string;
  stored_name: string;
  sort_index: number;
}): StoredRow | null {
  if (!isAuroraFormat(row.format)) return null;
  return {
    id: row.id,
    name: row.display_name,
    format: row.format,
    storedName: row.stored_name,
    sortIndex: row.sort_index,
  };
}

export async function listAuroraFiles(): Promise<StoredRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      display_name: string;
      format: string;
      stored_name: string;
      sort_index: number;
    }[]
  >`
    SELECT id, display_name, format, stored_name, sort_index
    FROM aurora_files
    ORDER BY sort_index, id
  `;
  return rows.flatMap((row) => {
    const mapped = mapRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function readAuroraSet(): Promise<
  { ok: true; files: AuroraFileText[] } | { ok: false; error: string }
> {
  const listed = await listAuroraFiles();
  const files: AuroraFileText[] = [];
  for (const file of listed) {
    let bytes: Buffer;
    try {
      bytes = await readFile(storedPath(file.storedName));
    } catch {
      return { ok: false, error: `Файл ${file.name} не найден. Каталог не изменён.` };
    }
    const decoded = decodeAuroraCsv(file.name, bytes);
    if (!decoded.ok) return decoded;
    files.push({ name: file.name, format: file.format, text: decoded.text });
  }
  return { ok: true, files };
}

export async function parseAuroraSet(): Promise<ParsedAurora> {
  const read = await readAuroraSet();
  if (!read.ok) return read;
  return combineAuroraFiles(read.files);
}

async function sweepOrphans(kept: ReadonlySet<string>): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(directory());
  } catch {
    return;
  }
  for (const name of names) {
    if (!STORED_NAME.test(name) || kept.has(name)) continue;
    await unlink(storedPath(name)).catch(() => undefined);
  }
}

export async function addAuroraFile(input: {
  bytes: Uint8Array;
  displayName: string;
  format: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAuroraFormat(input.format)) return { ok: false, error: "Укажите формат файла." };
  const name = displayFileName(input.displayName);
  if (!name) return { ok: false, error: "Нужен файл CSV." };
  if (input.bytes.byteLength <= 0) return { ok: false, error: "Файл пуст." };
  if (input.bytes.byteLength > AURORA_FILE_BYTES) {
    return { ok: false, error: "Файл больше 20 МБ." };
  }
  const decoded = decodeAuroraCsv(name, input.bytes);
  if (!decoded.ok) return decoded;
  const parsed = combineAuroraFiles([{ name, format: input.format, text: decoded.text }]);
  if (!parsed.ok) return parsed;
  const existing = await listAuroraFiles();
  if (existing.length >= AURORA_FILE_LIMIT) {
    return { ok: false, error: "Уже сохранено 20 файлов." };
  }
  const storedName = `${randomUUID()}.csv`;
  await ensureDir();
  await writeFile(storedPath(storedName), input.bytes, { mode: 0o640 });
  const sortIndex = existing.reduce((max, row) => Math.max(max, row.sortIndex), -1) + 1;
  try {
    await prisma.$executeRaw`
      INSERT INTO aurora_files (id, sort_index, display_name, stored_name, format)
      VALUES (${randomUUID()}, ${sortIndex}, ${name}, ${storedName}, ${input.format})
    `;
  } catch (error) {
    await unlink(storedPath(storedName)).catch(() => undefined);
    throw error;
  }
  await sweepOrphans(new Set([...existing.map((row) => row.storedName), storedName]));
  return { ok: true };
}

export async function removeAuroraFile(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await prisma.$queryRaw<{ stored_name: string }[]>`
    DELETE FROM aurora_files WHERE id = ${id} RETURNING stored_name
  `;
  const stored = rows[0]?.stored_name;
  if (!stored) return { ok: false, error: "Файл уже удалён." };
  if (STORED_NAME.test(stored)) await unlink(storedPath(stored)).catch(() => undefined);
  return { ok: true };
}

export async function moveAuroraFile(
  id: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const files = await listAuroraFiles();
  const index = files.findIndex((file) => file.id === id);
  if (index < 0) return { ok: false, error: "Файл уже удалён." };
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

/** Unlink committed files. A row stays when its file cannot be removed. */
export async function dropCommittedInbox(): Promise<void> {
  const files = await listAuroraFiles();
  const gone: string[] = [];
  let failed = false;
  for (const file of files) {
    try {
      await unlink(storedPath(file.storedName));
      gone.push(file.id);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") gone.push(file.id);
      else failed = true;
    }
  }
  if (gone.length > 0) {
    await prisma.$executeRaw`
      DELETE FROM aurora_files WHERE id IN (${Prisma.join(gone)})
    `;
  }
  if (failed) throw new Error("Не удалось удалить файлы.");
}
