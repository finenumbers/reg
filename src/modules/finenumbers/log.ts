/**
 * Two text files for one Finenumbers stage. The next stage truncates both.
 * A phone number, a range bound, a price, and a URL never land in the file.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FinenumbersLogSide = "purchased" | "free";

const FILE_NAME: Record<FinenumbersLogSide, string> = {
  purchased: "finenumbers-purchased.txt",
  free: "finenumbers-free.txt",
};
const FLUSH_AT = 64_000;
const REJECTED = "Площадка отклонила запрос.";

let chain: Promise<void> = Promise.resolve();
const pending: Record<FinenumbersLogSide, string> = { purchased: "", free: "" };

function directory(): string {
  return path.join(process.cwd(), "data", "numbering-sync");
}

function filePath(side: FinenumbersLogSide): string {
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

async function writeHandle(
  side: FinenumbersLogSide,
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

async function writeBoth(flags: "w" | "a", text: string): Promise<void> {
  await writeHandle("purchased", flags, text);
  await writeHandle("free", flags, text);
}

export async function beginFinenumbersLog(): Promise<void> {
  const header = sanitizeLogBlock(
    [
      "Источник: Finenumbers",
      "Список: диапазоны, затем номера",
      `Запуск: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
  );
  const body = header.endsWith("\n") ? header : `${header}\n`;
  await enqueue(async () => {
    pending.purchased = "";
    pending.free = "";
    await writeBoth("w", body);
  });
}

function queueBlock(side: FinenumbersLogSide | "both", block: string): Promise<void> {
  const text = sanitizeLogBlock(block);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return enqueue(async () => {
    const sides: FinenumbersLogSide[] = side === "both" ? ["purchased", "free"] : [side];
    for (const item of sides) {
      pending[item] += body;
      if (pending[item].length < FLUSH_AT) continue;
      const chunk = pending[item];
      pending[item] = "";
      await writeHandle(item, "a", chunk);
    }
  });
}

/** Page lines go to both logs. A side total uses appendFinenumbersSide. */
export async function appendFinenumbersLog(block: string): Promise<void> {
  await queueBlock("both", block);
}

export async function appendFinenumbersSide(
  side: FinenumbersLogSide,
  block: string,
): Promise<void> {
  await queueBlock(side, block);
}

export async function flushFinenumbersLog(): Promise<void> {
  await enqueue(async () => {
    for (const side of ["purchased", "free"] as const) {
      if (!pending[side]) continue;
      const body = pending[side];
      pending[side] = "";
      await writeHandle(side, "a", body);
    }
  });
}

export async function finenumbersLogExists(side: FinenumbersLogSide): Promise<boolean> {
  try {
    const info = await stat(filePath(side));
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function snapshotFinenumbersLog(
  side: FinenumbersLogSide,
): Promise<string | null> {
  await flushFinenumbersLog();
  if (!(await finenumbersLogExists(side))) return null;
  const dest = path.join(os.tmpdir(), `finenumbers-${side}-log-${randomUUID()}.txt`);
  await enqueue(() => copyFile(filePath(side), dest));
  return dest;
}
