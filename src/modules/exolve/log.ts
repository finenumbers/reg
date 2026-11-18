/**
 * One text file for the MTS Exolve stage. The next stage truncates it.
 * The key, a phone number, a price, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "exolve.txt";
const FLUSH_AT = 64_000;

let chain: Promise<void> = Promise.resolve();
let pending = "";

function directory(): string {
  return path.join(process.cwd(), "data", "numbering-sync");
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

export function sanitizeLogLine(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  if (!flat) return "";
  if (
    /bearer\s+/i.test(flat) ||
    /password/i.test(flat) ||
    /token/i.test(flat) ||
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

export async function beginExolveLog(runId: string): Promise<void> {
  const header = sanitizeLogBlock(
    [
      "Источник: MTS Exolve",
      "Список: купленные, затем свободные",
      `Запуск: ${new Date().toISOString()}`,
      `Идентификатор: ${runId}`,
      "",
    ].join("\n"),
  );
  const body = header.endsWith("\n") ? header : `${header}\n`;
  await enqueue(async () => {
    pending = "";
    await writeHandle("w", body);
  });
}

/** Holds the page line. A long walk flushes before the buffer grows without bound. */
export async function appendExolveLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(async () => {
    pending += body;
    if (pending.length < FLUSH_AT) return;
    const chunk = pending;
    pending = "";
    await writeHandle("a", chunk);
  });
}

export async function flushExolveLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle("a", body);
  });
}

export async function exolveLogExists(): Promise<boolean> {
  try {
    const info = await stat(filePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotExolveLog(): Promise<string | null> {
  if (!(await exolveLogExists())) return null;
  const dest = path.join(os.tmpdir(), `exolve-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(), dest));
  return dest;
}
