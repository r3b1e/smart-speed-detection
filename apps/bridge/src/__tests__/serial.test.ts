import { describe, expect, it } from "vitest";
import { pickPort, type SerialPortInfo } from "../sources/serial";

const ports: SerialPortInfo[] = [
  { path: "/dev/cu.Bluetooth-Incoming-Port" },
  { path: "/dev/cu.usbserial-A50285BI", vendorId: "0403", productId: "6001" },
  { path: "/dev/cu.usbmodem1101", vendorId: "2341", productId: "0043" },
];

describe("pickPort", () => {
  it("prefers the SERIAL_PORT override over any detection", () => {
    expect(pickPort(ports, "/dev/cu.usbmodem9999")).toBe("/dev/cu.usbmodem9999");
    expect(pickPort([], "/dev/cu.usbmodem9999")).toBe("/dev/cu.usbmodem9999");
  });

  it("auto-detects an Arduino-style USB serial port", () => {
    expect(pickPort(ports, null)).toBe("/dev/cu.usbserial-A50285BI");
    expect(pickPort([{ path: "/dev/cu.usbmodem2101" }], null)).toBe("/dev/cu.usbmodem2101");
  });

  it("prefers the macOS callout (cu.*) node over the blocking tty.* node", () => {
    const both: SerialPortInfo[] = [
      { path: "/dev/tty.usbserial-120", vendorId: "1a86", productId: "7523" },
      { path: "/dev/cu.usbserial-120", vendorId: "1a86", productId: "7523" },
    ];
    expect(pickPort(both, null)).toBe("/dev/cu.usbserial-120");
    expect(
      pickPort([{ path: "/dev/tty.usbserial-120", vendorId: "1a86" }], null)
    ).toBe("/dev/tty.usbserial-120");
  });

  it("falls back to vendor-id matching (Linux CDC, no cu.* name)", () => {
    const linuxish: SerialPortInfo[] = [
      { path: "/dev/ttyACM0", vendorId: "2341", productId: "0043" },
      { path: "/dev/ttyS0" },
    ];
    expect(pickPort(linuxish, null)).toBe("/dev/ttyACM0");
  });

  it("returns null when nothing looks like a device", () => {
    expect(pickPort([{ path: "/dev/cu.Bluetooth-Incoming-Port" }], null)).toBeNull();
    expect(pickPort([], null)).toBeNull();
  });

  it("skips unknown adapters in favour of later Arduino vendor ids", () => {
    const mixed: SerialPortInfo[] = [
      { path: "/dev/ttyUSB0", vendorId: "05ac" }, // unknown adapter
      { path: "/dev/ttyACM0", vendorId: "2a03" }, // Arduino.org CDC
    ];
    expect(pickPort(mixed, null)).toBe("/dev/ttyACM0");
  });
});
