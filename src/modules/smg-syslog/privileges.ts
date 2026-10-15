export type PrivilegeDrop = { uid: number; gid: number };

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value;
}

/**
 * Root may bind UDP 514, then must become the app user before creating files.
 * Without the env pair, a root test runner or a dev process stays as it is.
 */
export function privilegeDropTarget(
  uid: number,
  dropUidRaw: string | undefined,
  dropGidRaw: string | undefined,
): PrivilegeDrop | null {
  if (uid !== 0) return null;
  const dropUid = parseId(dropUidRaw);
  const dropGid = parseId(dropGidRaw);
  if (dropUid == null || dropGid == null) return null;
  if (dropUid === 0) return null;
  return { uid: dropUid, gid: dropGid };
}
