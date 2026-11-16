/**
 * Lease order for a catalog update that is not inside a source publish.
 * SipOut first, then Runexis, then UIS, then Aurora Telecom, then MTS Exolve, then Voximplant, then MCN Telecom.
 */

export const RESPLIT_SIPOUT_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM numbering_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_RUNEXIS_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM runexis_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_UIS_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM uis_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_AURORA_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM aurora_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_EXOLVE_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM exolve_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_VOXIMPLANT_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM voximplant_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_MCN_LOCK_SQL = `
  SELECT run_id,
    (
      heartbeat_at IS NOT NULL
      AND heartbeat_at >= CURRENT_TIMESTAMP - interval '2 minutes'
    ) AS fresh
  FROM mcn_sync_state
  WHERE id = 1
  FOR UPDATE
`;

export const RESPLIT_LOCKS = [
  RESPLIT_SIPOUT_LOCK_SQL,
  RESPLIT_RUNEXIS_LOCK_SQL,
  RESPLIT_UIS_LOCK_SQL,
  RESPLIT_AURORA_LOCK_SQL,
  RESPLIT_EXOLVE_LOCK_SQL,
  RESPLIT_VOXIMPLANT_LOCK_SQL,
  RESPLIT_MCN_LOCK_SQL,
] as const;
