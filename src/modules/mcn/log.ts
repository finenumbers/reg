/**
 * One text file for each MCN Telecom list. The next run of that list truncates it.
 * The key, a phone number, a price, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type McnLogSide = "purchased" | "free";

const FILE_NAME: Record<McnLogSide, string> = {
  purchased: "mcn-purchased.txt",
  free: "mcn-free.txt",
};
const FLUSH_AT = 64_000;
const REJECTED = "Площадка отклонила запрос.";

let chain: Promise<void> = Promise.resolve();
let pending = "";
let active: McnLogSide = "purchased";

function directory(): string {
  return path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(side: McnLogSide): string {
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
    /bearer/i.test(flat) ||
    /password/i.test(flat) ||
    /token/i.test(flat) ||
    /private_key/i.test(flat) ||
    /key=/i.test(flat) ||
    flat.includes("://") ||
    /\d{10}/.test(flat)
  ) {
    return REJECTED;
  }
  return flat.slice(0, 200);
}

export function sanitizeLogBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim() ? sanitizeLogLine(line) : ""))
    .join("\n");
}

async function writeHandle(side: McnLogSide, flags: "w" | "a", text: string): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
  const handle = await open(filePath(side), flags, 0o640);
  try {
    await handle.write(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function beginMcnLog(runId: string, side: McnLogSide): Promise<void> {
  const title = side === "purchased" ? "Купленные" : "Свободные";
  const header = sanitizeLogBlock(
    [
      "Источник: MCN Telecom",
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

export async function appendMcnLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(async () => {
    pending += body;
    if (pending.length < FLUSH_AT) return;
    const chunk = pending;
    pending = "";
    await writeHandle(active, "a", chunk);
  });
}

export async function flushMcnLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle(active, "a", body);
  });
}

export async function mcnLogExists(side: McnLogSide): Promise<boolean> {
  try {
    const info = await stat(filePath(side));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotMcnLog(side: McnLogSide): Promise<string | null> {
  if (side === active) await flushMcnLog();
  if (!(await mcnLogExists(side))) return null;
  const dest = path.join(os.tmpdir(), `mcn-${side}-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(side), dest));
  return dest;
}
