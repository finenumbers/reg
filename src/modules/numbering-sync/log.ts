/**
 * One text file for each SipOut list. The next run of that list truncates it.
 * The key, the query, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SipoutLogSide = "purchased" | "free";

const FILE_NAME: Record<SipoutLogSide, string> = {
  purchased: "sipout-purchased.txt",
  free: "sipout-free.txt",
};

let dirOverride: string | null = null;
let chain: Promise<void> = Promise.resolve();

export function setNumberingSyncLogDirForTests(dir: string | null): void {
  dirOverride = dir;
  chain = Promise.resolve();
}

function directory(): string {
  return dirOverride ?? path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(side: SipoutLogSide): string {
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

/** One line. A secret or a URL becomes a fixed refusal. Blank lines stay blank. */
export function sanitizeLogLine(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  if (!flat) return "";
  if (/key=/i.test(flat) || flat.includes("://")) return "Площадка отклонила запрос.";
  return flat.slice(0, 300);
}

export function sanitizeLogBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim() ? sanitizeLogLine(line) : ""))
    .join("\n");
}

async function writeHandle(side: SipoutLogSide, flags: "w" | "a", text: string): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
  const handle = await open(filePath(side), flags, 0o640);
  try {
    await handle.write(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Truncate and write the header before the first request of this list. */
export async function beginSipoutLog(runId: string, side: SipoutLogSide): Promise<void> {
  const title = side === "purchased" ? "Купленные" : "Свободные";
  const header = sanitizeLogBlock(
    [
      "Источник: SipOut",
      `Список: ${title}`,
      `Запуск: ${new Date().toISOString()}`,
      `Идентификатор: ${runId}`,
      "",
    ].join("\n"),
  );
  await enqueue(() =>
    writeHandle(side, "w", header.endsWith("\n") ? header : `${header}\n`),
  );
}

export async function appendSipoutLog(side: SipoutLogSide, block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(() => writeHandle(side, "a", body));
}

export async function sipoutLogExists(side: SipoutLogSide): Promise<boolean> {
  try {
    const info = await stat(filePath(side));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** A copy taken after the writer queue, so the reader sees whole lines. */
export async function snapshotSipoutLog(side: SipoutLogSide): Promise<string | null> {
  if (!(await sipoutLogExists(side))) return null;
  const dest = path.join(os.tmpdir(), `sipout-${side}-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(side), dest));
  return dest;
}
