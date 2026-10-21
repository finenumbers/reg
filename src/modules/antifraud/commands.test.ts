import { describe, expect, it } from "vitest";
import {
  assertParkingCommand,
  buildReadCommand,
  ParkingCommandError,
  statCommand,
} from "@/modules/antifraud/commands";
import { parseParkingLogPath } from "@/modules/antifraud/target";

const path = parseParkingLogPath("/var/log/freeradius/calls.log");
if (!path) throw new Error("fixture path");

describe("parking read commands", () => {
  it("builds a digit offset and never names an output file", () => {
    const command = buildReadCommand(BigInt(1048576), path);
    expect(command).toBe(
      "sudo -n -- /bin/dd if=/var/log/freeradius/calls.log bs=1048576 iflag=skip_bytes,count_bytes skip=1048576 count=1048576 status=none",
    );
    expect(command.includes("of=")).toBe(false);
    expect(statCommand(path)).toBe(
      "sudo -n -- /usr/bin/stat -c %s:%i /var/log/freeradius/calls.log",
    );
    expect(() => assertParkingCommand(command)).not.toThrow();
    expect(() => assertParkingCommand(statCommand(path))).not.toThrow();
  });

  it("rejects an offset that is not a bounded bigint", () => {
    expect(() => buildReadCommand(BigInt(-1), path)).toThrow(ParkingCommandError);
    expect(() => buildReadCommand(BigInt(10) ** BigInt(19), path)).toThrow(
      ParkingCommandError,
    );
    expect(() => buildReadCommand(1 as unknown as bigint, path)).toThrow(
      ParkingCommandError,
    );
  });

  it("rejects a command that is not the stat or dd of a parsed path", () => {
    expect(() => assertParkingCommand(`${statCommand(path)}; id`)).toThrow(
      ParkingCommandError,
    );
    expect(() =>
      assertParkingCommand(
        "sudo -n -- /bin/dd if=/var/log/freeradius/calls.log of=/tmp/x bs=1048576 iflag=skip_bytes,count_bytes skip=0 count=1048576 status=none",
      ),
    ).toThrow(ParkingCommandError);
  });
});
