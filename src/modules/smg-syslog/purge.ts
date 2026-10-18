import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { bucketOf } from "@/modules/smg-syslog/bucket";
import {
  invalidateSyslogStoredBytes,
  listSyslogPurgeMonths,
  syslogDeviceLocation,
} from "@/modules/smg-syslog/browse";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";
import {
  invalidateSyslogMonthInventory,
  listSyslogMonthTargets,
} from "@/modules/smg-syslog/month-inventory";
import { currentUtcMonth, monthKey as cdrMonthKey } from "@/modules/traffic/cdr-month";

export type SyslogCutoff = { year: string; month: string };

export type SyslogPurgeResult =
  | { ok: true; deleted: SyslogCutoff[] }
  | {
      ok: false;
      code: "INVALID" | "BAD_CUTOFF" | "PARTIAL";
      deleted: SyslogCutoff[];
      message: string;
    };

function monthKey(year: string, month: string): number {
  return Number(year) * 12 + Number(month);
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Delete every stored month of one device strictly before `cutoff`.
 * The cutoff month, the current UTC month, and anything newer stay.
 */
export async function purgeSyslogBefore(
  root: string,
  device: string,
  cutoff: SyslogCutoff,
  now: Date,
): Promise<SyslogPurgeResult> {
  const located = syslogDeviceLocation(root, device);
  if (located.status !== "directory") {
    return { ok: false, code: "INVALID", deleted: [], message: "Узел не найден" };
  }
  const allowed = listSyslogPurgeMonths(root, device, now);
  if (
    !allowed?.some((month) => month.year === cutoff.year && month.month === cutoff.month)
  ) {
    return {
      ok: false,
      code: "BAD_CUTOFF",
      deleted: [],
      message: "Этот месяц нельзя выбрать границей удаления",
    };
  }

  const cutoffKey = monthKey(cutoff.year, cutoff.month);
  const deleted: SyslogCutoff[] = [];
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { ok: false, code: "INVALID", deleted, message: "Том Syslog недоступен" };
  }

  let years: string[] = [];
  try {
    years = readdirSync(located.dir);
  } catch {
    years = [];
  }
  years = years.filter((name) => /^\d{4}$/.test(name)).sort((a, b) => a.localeCompare(b));

  try {
    for (const year of years) {
      const yearDir = path.resolve(located.dir, year);
      if (!isInsideRoot(rootReal, yearDir)) continue;
      let yearStat;
      try {
        yearStat = lstatSync(yearDir);
      } catch {
        continue;
      }
      if (yearStat.isSymbolicLink()) {
        if (Number(year) < Number(cutoff.year)) {
          await unlink(yearDir);
        }
        continue;
      }
      if (!yearStat.isDirectory()) continue;

      let months: string[] = [];
      try {
        months = readdirSync(yearDir);
      } catch {
        months = [];
      }
      months = months
        .filter((name) => /^\d{2}$/.test(name))
        .sort((a, b) => a.localeCompare(b));
      for (const month of months) {
        const monthNumber = Number(month);
        if (monthNumber < 1 || monthNumber > 12) continue;
        if (monthKey(year, month) >= cutoffKey) continue;
        const live = bucketOf(new Date(), 0);
        if (monthKey(year, month) >= monthKey(live.year, live.month)) continue;
        const monthDir = path.resolve(yearDir, month);
        if (!isInsideRoot(rootReal, monthDir)) continue;
        await removeMonthEntry(monthDir, rootReal);
        deleted.push({ year, month });
      }
      await removeYearIfEmpty(yearDir);
    }
  } catch {
    if (deleted.length > 0) {
      invalidateSyslogStoredBytes(root, device);
      invalidateSyslogMonthInventory();
    }
    return {
      ok: false,
      code: "PARTIAL",
      deleted,
      message: "Не удалось удалить все файлы старше выбранного месяца",
    };
  }
  if (deleted.length > 0) {
    invalidateSyslogStoredBytes(root, device);
    invalidateSyslogMonthInventory();
  }
  return { ok: true, deleted };
}

/**
 * Delete one UTC month on every device. The current month is refused.
 * A symlink month entry is unlinked and not followed. The device directory stays.
 */
export async function deleteSyslogMonth(
  root: string,
  year: number,
  month: number,
  now: Date,
  onProgress: (done: number, total: number, held?: boolean) => Promise<void>,
): Promise<number> {
  const key = cdrMonthKey(year, month);
  const currentKey = currentUtcMonth(now).key;
  const live = bucketOf(now, 0);
  if (key === currentKey || key >= `${live.year}-${live.month}`) {
    throw new Error("Текущий месяц удалить нельзя");
  }

  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch (error) {
    if (errno(error) === "ENOENT") {
      await onProgress(0, 0);
      return 0;
    }
    throw error;
  }

  const targets = await listSyslogMonthTargets(root, year, month);
  const total = targets.reduce((sum, target) => sum + target.files, 0);
  if (total > 0) await onProgress(0, total);
  let done = 0;
  try {
    for (const target of targets) {
      await removeMonthEntry(target.monthDir, rootReal);
      await removeYearIfEmpty(target.yearDir);
      invalidateSyslogStoredBytes(root, target.ip);
      done += target.files;
      await onProgress(done, total, true);
    }
  } finally {
    invalidateSyslogMonthInventory();
  }
  if (total === 0) await onProgress(0, 0);
  return done;
}

async function removeMonthEntry(monthDir: string, rootReal: string): Promise<void> {
  let stat;
  try {
    stat = lstatSync(monthDir);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    await unlink(monthDir);
    return;
  }
  if (!stat.isDirectory()) return;
  const real = realpathSync(monthDir);
  if (!isInsideRoot(rootReal, real)) throw new Error("syslog path escape");
  await rm(monthDir, { recursive: true, force: true });
}

async function removeYearIfEmpty(yearDir: string): Promise<void> {
  let names: string[] = [];
  try {
    names = readdirSync(yearDir);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
  if (names.some((name) => !name.startsWith("."))) return;
  try {
    await rmdir(yearDir);
  } catch (error) {
    const code = errno(error);
    if (code === "ENOTEMPTY" || code === "ENOENT") return;
    throw error;
  }
}

export type DeviceRemoval = "removed" | "missing" | "remains" | "refused";

/** Remove one device directory. A symlink is unlinked and its target is left in place. */
export async function removeSyslogDeviceDirectory(
  root: string,
  device: string,
): Promise<DeviceRemoval> {
  const ip = canonicalIpv4(device);
  if (!ip) return "refused";
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return "refused";
  }
  const dir = path.resolve(rootReal, ip);
  if (!isInsideRoot(rootReal, dir)) return "refused";
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (errno(error) === "ENOENT") return "missing";
    return "refused";
  }
  if (stat.isSymbolicLink()) {
    try {
      await unlink(dir);
    } catch (error) {
      if (errno(error) === "ENOENT") return "missing";
      return "remains";
    }
    invalidateSyslogStoredBytes(root, ip);
    invalidateSyslogMonthInventory();
    return "removed";
  }
  if (!stat.isDirectory()) return "refused";
  try {
    const real = realpathSync(dir);
    if (real !== dir || !isInsideRoot(rootReal, real)) return "refused";
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (errno(error) === "ENOENT") return "missing";
    return "remains";
  }
  try {
    lstatSync(dir);
    return "remains";
  } catch (error) {
    if (errno(error) === "ENOENT") {
      invalidateSyslogStoredBytes(root, ip);
      invalidateSyslogMonthInventory();
      return "removed";
    }
    return "remains";
  }
}

export type SyslogNodeRow = { ip: string; name: string; identifier: string | null };

export type EraseSyslogNodeResult =
  | { ok: true; node: SyslogNodeRow | null; filesRemoved: boolean; leftover: boolean }
  | {
      ok: false;
      code: "NOT_FOUND" | "BRIDGE" | "RECREATED" | "REMAINS";
      message: string;
      node: SyslogNodeRow | null;
      filesRemoved: boolean;
    };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Drop a registered node, wait for the receiver registry, then delete its directory.
 * A second pass catches a datagram that was already queued. Delays are injectable.
 */
export async function eraseSyslogNode(input: {
  root: string;
  ip: string;
  bridge: boolean;
  loadNode: () => Promise<SyslogNodeRow | null>;
  deleteNode: () => Promise<SyslogNodeRow | null>;
  settleMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<EraseSyslogNodeResult> {
  const sleep = input.sleep ?? defaultSleep;
  const settleMs = input.settleMs ?? 2000;
  const retryMs = input.retryMs ?? 500;
  const existing = await input.loadNode();
  if (!existing && input.bridge) {
    return {
      ok: false,
      code: "BRIDGE",
      message: "Мост Docker не удаляется этой кнопкой",
      node: null,
      filesRemoved: false,
    };
  }

  let node = existing;
  let leftover = false;
  if (!existing) {
    const located = syslogDeviceLocation(input.root, input.ip);
    if (located.status !== "directory") {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Узел не найден",
        node: null,
        filesRemoved: false,
      };
    }
    leftover = true;
  } else {
    node = await input.deleteNode();
    await sleep(settleMs);
    if (await input.loadNode()) {
      return {
        ok: false,
        code: "RECREATED",
        message: "Узел уже добавлен снова",
        node,
        filesRemoved: false,
      };
    }
  }

  const first = await removeSyslogDeviceDirectory(input.root, input.ip);
  if (first === "refused" || first === "remains") {
    return {
      ok: false,
      code: "REMAINS",
      message: `Не удалось удалить файлы узла ${input.ip}`,
      node,
      filesRemoved: false,
    };
  }
  await sleep(retryMs);
  if (await input.loadNode()) {
    return {
      ok: false,
      code: "RECREATED",
      message: "Узел уже добавлен снова",
      node,
      filesRemoved: first === "removed",
    };
  }
  const second = await removeSyslogDeviceDirectory(input.root, input.ip);
  if (second === "remains" || second === "refused") {
    return {
      ok: false,
      code: "REMAINS",
      message: `Не удалось удалить файлы узла ${input.ip}`,
      node,
      filesRemoved: false,
    };
  }
  return { ok: true, node, filesRemoved: true, leftover };
}
