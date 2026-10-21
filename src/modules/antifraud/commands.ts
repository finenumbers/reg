import {
  CALLS_LOG_PATH,
  READ_CHUNK_BYTES,
  STAT_COMMAND,
} from "@/modules/antifraud/constants";

const MAX_OFFSET = BigInt(10) ** BigInt(18);

export class ParkingCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParkingCommandError";
  }
}

function assertReadCommand(command: string): void {
  if (command.includes("of=")) {
    throw new ParkingCommandError("Запись запрещена");
  }
  if (/[;&|`$<>\\]/.test(command)) {
    throw new ParkingCommandError("Команда отклонена");
  }
  const expected =
    "sudo -n -- /bin/dd if=/var/log/freeradius/calls.log bs=1048576 iflag=skip_bytes,count_bytes skip=";
  if (!command.startsWith(expected) || !command.endsWith(" count=1048576 status=none")) {
    throw new ParkingCommandError("Команда отклонена");
  }
  if (command.includes("\n") || command.includes("\r")) {
    throw new ParkingCommandError("Команда отклонена");
  }
}

/** Byte range of calls.log. Offset is decimal digits only. */
export function buildReadCommand(offset: bigint): string {
  if (typeof offset !== "bigint" || offset < BigInt(0) || offset > MAX_OFFSET) {
    throw new ParkingCommandError("Некорректный offset");
  }
  const digits = offset.toString(10);
  if (!/^\d+$/.test(digits)) {
    throw new ParkingCommandError("Некорректный offset");
  }
  const command = `sudo -n -- /bin/dd if=${CALLS_LOG_PATH} bs=${READ_CHUNK_BYTES} iflag=skip_bytes,count_bytes skip=${digits} count=${READ_CHUNK_BYTES} status=none`;
  assertReadCommand(command);
  return command;
}

export function statCommand(): string {
  return STAT_COMMAND;
}
