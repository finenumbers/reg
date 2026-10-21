import { describe, expect, it } from "vitest";
import {
  CALLS_LOG_PATH,
  PARKING_HOST,
  PARKING_USER,
} from "@/modules/antifraud/constants";
import {
  parseParkingHost,
  parseParkingLogPath,
  parseParkingUser,
} from "@/modules/antifraud/target";

describe("parking target parsers", () => {
  it("accepts the built-in parking target", () => {
    expect(parseParkingHost(PARKING_HOST)).toBe(PARKING_HOST);
    expect(parseParkingUser(PARKING_USER)).toBe(PARKING_USER);
    expect(parseParkingLogPath(CALLS_LOG_PATH)).toBe(CALLS_LOG_PATH);
  });

  it("lowercases a hostname and keeps the username case", () => {
    expect(parseParkingHost("Parking.FineNumbers.com")).toBe("parking.finenumbers.com");
    expect(parseParkingUser("DvPershin")).toBe("DvPershin");
  });

  it("accepts an address and rejects a user or a port glued to the host", () => {
    expect(parseParkingHost("10.1.2.3")).toBe("10.1.2.3");
    expect(parseParkingHost("2001:db8::1")).toBe("2001:db8::1");
    expect(parseParkingHost("dvpershin@parking.finenumbers.com")).toBeNull();
    expect(parseParkingHost("parking.finenumbers.com:22")).toBeNull();
    expect(parseParkingHost("fe80::1%eth0")).toBeNull();
  });

  it("rejects a path that could change the remote command", () => {
    expect(parseParkingLogPath("/var/log/freeradius/calls.log;id")).toBeNull();
    expect(parseParkingLogPath("/tmp/calls.log && id")).toBeNull();
    expect(parseParkingLogPath("/tmp/of=x")).toBeNull();
    expect(parseParkingLogPath("var/log/calls.log")).toBeNull();
    expect(parseParkingLogPath("/var/log/../calls.log")).toBeNull();
    expect(parseParkingLogPath("/var//log/calls.log")).toBeNull();
    expect(parseParkingLogPath("/var/log/calls.log/")).toBeNull();
    expect(parseParkingLogPath("/var/log/my calls.log")).toBeNull();
  });
});
