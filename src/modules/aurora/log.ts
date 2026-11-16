/**
 * One text file for the Aurora stage. The next stage truncates it.
 * Numbers and CSV bodies never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "aurora.txt";

let dirOverride: string | null = null;
let chain: Promise<void> = Promise.resolve();
let pending = "";

export function setAuroraLogDirForTests(dir: string | null): void {
  dirOverride = dir;
  pending = "";
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
  if (/bearer\s+/i.test(flat) || /password/i.test(flat) || /token/i.test(flat) || /key=/i.test(flat) || flat.includes("://")) {
    return "Строка журнала пропущена.";
  }
  return flat.slice(0, 300);
}

function sanitizeBlock(block: string): string {
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

export async function beginAuroraLog(runId: string): Promise<void> {
  const header = sanitizeBlock(
    [
      "Источник: Aurora Telecom",
      "Список: свободные номера по ссылкам",
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

export async function appendAuroraLog(block: string): Promise<void> {
  const text = sanitizeBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  await enqueue(async () => {
    pending += body;
  });
}

export async function flushAuroraLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle("a", body);
  });
}

export async function auroraLogExists(): Promise<boolean> {
  try {
    const info = await stat(filePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotAuroraLog(): Promise<string | null> {
  if (!(await auroraLogExists())) return null;
  const dest = path.join(os.tmpdir(), `aurora-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(), dest));
  return dest;
}
