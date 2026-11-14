/**
 * One text file for the Runexis stage. The next stage truncates it.
 * The password, the token, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "runexis.txt";

let dirOverride: string | null = null;
let chain: Promise<void> = Promise.resolve();

export function setRunexisLogDirForTests(dir: string | null): void {
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

export function sanitizeLogLine(text: string): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  if (!flat) return "";
  if (/bearer\s+/i.test(flat) || /password/i.test(flat) || flat.includes("://")) {
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

export async function beginRunexisLog(runId: string): Promise<void> {
  const header = sanitizeLogBlock(
    [
      "Источник: Runexis",
      "Список: свободные номера",
      `Запуск: ${new Date().toISOString()}`,
      `Идентификатор: ${runId}`,
      "",
    ].join("\n"),
  );
  await enqueue(() => writeHandle("w", header.endsWith("\n") ? header : `${header}\n`));
}

export async function appendRunexisLog(block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(() => writeHandle("a", body));
}

export async function runexisLogExists(): Promise<boolean> {
  try {
    const info = await stat(filePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotRunexisLog(): Promise<string | null> {
  if (!(await runexisLogExists())) return null;
  const dest = path.join(os.tmpdir(), `runexis-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(), dest));
  return dest;
}
