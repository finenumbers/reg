import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Fixed generation. A different string wipes the volume again. */
export const SYSLOG_VOLUME_RESET_ID = "line-format-2026-10-15";

const MARKER = ".volume-reset";

/**
 * Delete captured syslog files once. The marker stays in the volume so a
 * later start of this release does not delete the new files. Returns true
 * when this call performed the delete.
 */
export function resetSyslogVolumeOnce(root: string): boolean {
  mkdirSync(root, { recursive: true, mode: 0o750 });
  const marker = path.join(root, MARKER);
  if (readMarker(marker) === SYSLOG_VOLUME_RESET_ID) return false;

  let names: string[];
  try {
    names = readdirSync(root);
  } catch (error) {
    throw new Error(
      `syslog volume unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const name of names) {
    if (name === MARKER) continue;
    const full = path.resolve(root, name);
    const relative = path.relative(root, full);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("syslog volume escape");
    }
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) unlinkSync(full);
    else rmSync(full, { recursive: true, force: true });
  }

  writeFileSync(marker, `${SYSLOG_VOLUME_RESET_ID}\n`, { mode: 0o640 });
  const fileFd = openSync(marker, "r+");
  try {
    fsyncSync(fileFd);
  } finally {
    closeSync(fileFd);
  }
  const dirFd = openSync(root, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  return true;
}

function readMarker(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}
