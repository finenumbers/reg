import { describe, expect, it } from "vitest";
import {
  buildReadCommand,
  ParkingCommandError,
  statCommand,
} from "@/modules/antifraud/commands";

describe("parking read commands", () => {
  it("builds a digit offset and never names an output file", () => {
    const command = buildReadCommand(BigInt(1048576));
    expect(command).toBe(
      "sudo -n -- /bin/dd if=/var/log/freeradius/calls.log bs=1048576 iflag=skip_bytes,count_bytes skip=1048576 count=1048576 status=none",
    );
    expect(command.includes("of=")).toBe(false);
    expect(statCommand()).toBe(
      "sudo -n -- /usr/bin/stat -c %s:%i /var/log/freeradius/calls.log",
    );
  });

  it("rejects an offset that is not a bounded bigint", () => {
    expect(() => buildReadCommand(BigInt(-1))).toThrow(ParkingCommandError);
    expect(() => buildReadCommand(BigInt(10) ** BigInt(19))).toThrow(ParkingCommandError);
    expect(() => buildReadCommand(1 as unknown as bigint)).toThrow(ParkingCommandError);
  });
});
