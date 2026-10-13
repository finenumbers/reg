export type SmgRefreshDecision = {
  reload: boolean;
  since: string | null;
};

/**
 * First poll (no since) never reloads. A failed status leaves the cursor.
 * `changed` is true only when a later SMG import inserted rows or bad lines.
 */
export function decideSmgRefresh(input: {
  ok: boolean;
  since: string | null;
  cursor: string | null;
  changed: boolean;
}): SmgRefreshDecision {
  if (!input.ok) return { reload: false, since: input.since };
  return {
    reload: input.since != null && input.changed,
    since: input.cursor ?? input.since,
  };
}
