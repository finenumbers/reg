import { READ_CHUNK_BYTES } from "@/modules/antifraud/constants";
import { parseParkingLogPath, type ParkingLogPath } from "@/modules/antifraud/target";

const MAX_OFFSET = BigInt(10) ** BigInt(18);

export class ParkingCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParkingCommandError";
  }
}

function assertShape(
  command: string,
  logPath: ParkingLogPath,
  offsetDigits: string,
): void {
  if (command.includes("of=") || command.includes("\n") || command.includes("\r")) {
    throw new ParkingCommandError("Команда отклонена");
  }
  if (/[;&|`$<>\\\s]/.test(logPath) || /[;&|`$<>\\]/.test(command)) {
    throw new ParkingCommandError("Команда отклонена");
  }
  const expected = `sudo -n -- /bin/dd if=${logPath} bs=${READ_CHUNK_BYTES} iflag=skip_bytes,count_bytes skip=${offsetDigits} count=${READ_CHUNK_BYTES} status=none`;
  if (command !== expected) throw new ParkingCommandError("Команда отклонена");
}

/** Byte range of the configured log. Offset is decimal digits only. */
export function buildReadCommand(offset: bigint, logPath: ParkingLogPath): string {
  if (typeof offset !== "bigint" || offset < BigInt(0) || offset > MAX_OFFSET) {
    throw new ParkingCommandError("Некорректный offset");
  }
  const digits = offset.toString(10);
  if (!/^\d+$/.test(digits)) throw new ParkingCommandError("Некорректный offset");
  const command = `sudo -n -- /bin/dd if=${logPath} bs=${READ_CHUNK_BYTES} iflag=skip_bytes,count_bytes skip=${digits} count=${READ_CHUNK_BYTES} status=none`;
  assertShape(command, logPath, digits);
  return command;
}

export function statCommand(logPath: ParkingLogPath): string {
  return `sudo -n -- /usr/bin/stat -c %s:%i ${logPath}`;
}

/** Accept only a stat or dd command built for a parsed path. */
export function assertParkingCommand(command: string): void {
  const stat = /^sudo -n -- \/usr\/bin\/stat -c %s:%i (\/\S+)$/.exec(command);
  if (stat?.[1]) {
    const path = parseParkingLogPath(stat[1]);
    if (path && statCommand(path) === command) return;
  }
  const read =
    /^sudo -n -- \/bin\/dd if=(\/\S+) bs=1048576 iflag=skip_bytes,count_bytes skip=(\d+) count=1048576 status=none$/.exec(
      command,
    );
  if (read?.[1] && read[2]) {
    const path = parseParkingLogPath(read[1]);
    if (path && buildReadCommand(BigInt(read[2]), path) === command) return;
  }
  throw new ParkingCommandError("Команда отклонена");
}
