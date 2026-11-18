/**
 * One text file for the Voximplant stage. The next stage truncates it.
 * The key, a phone number, a price, and the URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FILE_NAME = "voximplant.txt";
const FLUSH_AT = 64_000;
const REJECTED = "Площадка отклонила запрос.";

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

export async function beginVoximplantLog(): Promise<void> {
  const header = sanitizeLogBlock(
    [
      "Источник: Voximplant",
      "Список: купленные, затем свободные",
      `Запуск: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
  );
  const body = header.endsWith("\n") ? header : `${header}\n`;
  await enqueue(async () => {
    pending = "";
    await writeHandle("w", body);
  });
}

export async function appendVoximplantLog(block: string): Promise<void> {
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

export async function flushVoximplantLog(): Promise<void> {
  await enqueue(async () => {
    if (!pending) return;
    const body = pending;
    pending = "";
    await writeHandle("a", body);
  });
}

export async function voximplantLogExists(): Promise<boolean> {
  try {
    const info = await stat(filePath());
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotVoximplantLog(): Promise<string | null> {
  if (!(await voximplantLogExists())) return null;
  const dest = path.join(os.tmpdir(), `voximplant-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(), dest));
  return dest;
}
