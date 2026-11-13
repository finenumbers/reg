/**
 * One text file for the SipOut stage. The next stage truncates it.
 * The key, the query, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "sipout.txt";

let dirOverride: string | null = null;
let chain: Promise<void> = Promise.resolve();

export function setNumberingSyncLogDirForTests(dir: string | null): void {
  dirOverride = dir;
  chain = Promise.resolve();
}

function directory(): string {
  return dirOverride ?? path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(): string {
  return path.join(directory(), FILE_NAME);
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

async function writeHandle(flags: "w" | "a", text: string): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
  const handle = await open(filePath(), flags, 0o640);
  try {
    await handle.write(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Truncate and write the header before the first SipOut request. */
export async function beginSipoutLog(runId: string): Promise<void> {
  const header = sanitizeLogBlock(
    ["Источник: SipOut", `Запуск: ${new Date().toISOString()}`, `Идентификатор: ${runId}`, ""].join(
      "\n",
    ),
  );
  await enqueue(() => writeHandle("w", header.endsWith("\n") ? header : `${header}\n`));
}

export async function appendSipoutLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(() => writeHandle("a", body));
}

export async function sipoutLogExists(): Promise<boolean> {
  try {
    const info = await stat(filePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** A copy taken after the writer queue, so the reader sees whole lines. */
export async function snapshotSipoutLog(): Promise<string | null> {
  if (!(await sipoutLogExists())) return null;
  const dest = path.join(os.tmpdir(), `sipout-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(), dest));
  return dest;
}
