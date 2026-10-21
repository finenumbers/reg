/**
 * Parking FreeRADIUS reader. Host, user, port, and path are constants.
 * The softswitch SSH profile never sees this key, and this reader never
 * dials the softswitch host.
 */

export const PARKING_HOST = "parking.finenumbers.com";
export const PARKING_PORT = 22;
export const PARKING_USER = "dvpershin";

/** ED25519 host key observed on parking.finenumbers.com. */
export const PARKING_HOST_KEY_SHA256 =
  "SHA256:59OEiuYklI+oPFYhB6yzAmZtucyOMYSaYpEOTXKSlTs";

export const CALLS_LOG_PATH = "/var/log/freeradius/calls.log";

export const READ_CHUNK_BYTES = 1_048_576;
export const TICK_BUDGET_BYTES = 64 * 1024 * 1024;
export const PARKING_INTERVAL_MS = 60_000;

export const STAT_COMMAND =
  "sudo -n -- /usr/bin/stat -c %s:%i /var/log/freeradius/calls.log";
