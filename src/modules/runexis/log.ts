/**
 * One text file for each Runexis list. The next run of that list truncates it.
 * The password, the token, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type RunexisLogSide = "purchased" | "free";

const FILE_NAME: Record<RunexisLogSide, string> = {
  purchased: "runexis-purchased.txt",
  free: "runexis-free.txt",
};

let dirOverride: string | null = null;
let chain: Promise<void> = Promise.resolve();
let pending = "";
let active: RunexisLogSide = "purchased";

export function setRunexisLogDirForTests(dir: string | null): void {
  dirOverride = dir;
  pending = "";
  active = "purchased";
  chain = Promise.resolve();
}

function directory(): string {
  return dirOverride ?? path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(side: RunexisLogSide): string {
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

async function writeHandle(
  side: RunexisLogSide,
  flags: "w" | "a",
  text: string,
): Promise<void> {
  await mkdir(directory(), { recursive: true, mode: 0o750 });
  const handle = await open(filePath(side), flags, 0o640);
  try {
    await handle.write(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function beginRunexisLog(
  runId: string,
  side: RunexisLogSide,
): Promise<void> {
  const title = side === "purchased" ? "Купленные" : "Свободные";
  const header = sanitizeLogBlock(
    [
      "Источник: Runexis",
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

/** Holds the page line. The file is synced at the end of a code and on failure. */
export async function appendRunexisLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(async () => {
    pending += body;
  });
}

export async function flushRunexisLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle(active, "a", body);
  });
}

export async function runexisLogExists(side: RunexisLogSide): Promise<boolean> {
  try {
    const info = await stat(filePath(side));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotRunexisLog(side: RunexisLogSide): Promise<string | null> {
  if (side === active) await flushRunexisLog();
  if (!(await runexisLogExists(side))) return null;
  const dest = path.join(os.tmpdir(), `runexis-${side}-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(side), dest));
  return dest;
}
