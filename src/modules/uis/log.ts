/**
 * One text file for each UIS list. The next run of that list truncates it.
 * The key, the token, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type UisLogSide = "purchased" | "free";

const FILE_NAME: Record<UisLogSide, string> = {
  purchased: "uis-purchased.txt",
  free: "uis-free.txt",
};

let chain: Promise<void> = Promise.resolve();
let pending = "";
let active: UisLogSide = "purchased";

function directory(): string {
  return path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(side: UisLogSide): string {
  return path.join(directory(), FILE_NAME[side]);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function sanitizeLogLine(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  if (!flat) return "";
  if (
    /bearer\s+/i.test(flat) ||
    /password/i.test(flat) ||
    /token/i.test(flat) ||
    /access_token/i.test(flat) ||
    /key=/i.test(flat) ||
    flat.includes("://")
  ) {
    return "Площадка отклонила запрос.";
  }
  return flat.slice(0, 300);
}

export function sanitizeLogBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim() ? sanitizeLogLine(line) : ""))
    .join("\n");
}

async function writeHandle(side: UisLogSide, flags: "w" | "a", text: string): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
  const handle = await open(filePath(side), flags, 0o640);
  try {
    await handle.write(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function beginUisLog(runId: string, side: UisLogSide): Promise<void> {
  const title = side === "purchased" ? "Купленные" : "Свободные";
  const header = sanitizeLogBlock(
    [
      "Источник: UIS",
      `Список: ${title}`,
      `Запуск: ${new Date().toISOString()}`,
      `Идентификатор: ${runId}`,
      "",
    ].join("\n"),
  );
  const body = header.endsWith("\n") ? header : `${header}\n`;
  await enqueue(async () => {
    active = side;
    pending = "";
    await writeHandle(side, "w", body);
  });
}

/** Holds the page line. The file is synced at the end of a slice and on failure. */
export async function appendUisLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(async () => {
    pending += body;
  });
}

export async function flushUisLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle(active, "a", body);
  });
}

export async function uisLogExists(side: UisLogSide): Promise<boolean> {
  try {
    const info = await stat(filePath(side));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotUisLog(side: UisLogSide): Promise<string | null> {
  if (side === active) await flushUisLog();
  if (!(await uisLogExists(side))) return null;
  const dest = path.join(os.tmpdir(), `uis-${side}-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(side), dest));
  return dest;
}
