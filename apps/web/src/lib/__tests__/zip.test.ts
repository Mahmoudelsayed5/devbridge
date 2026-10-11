import { describe, expect, it } from "vitest";

import { createZip, crc32 } from "../zip.js";

const FIXED = new Date(Date.UTC(2026, 0, 2, 3, 4, 6));

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8);
}

describe("crc32", () => {
  it("matches the published check values", () => {
    const encoder = new TextEncoder();

    // The ZIP/PKZIP CRC-32 of "123456789" is the standard check value.
    expect(crc32(encoder.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(encoder.encode(""))).toBe(0);
    expect(crc32(encoder.encode("a"))).toBe(0xe8b7be43);
  });
});

describe("createZip", () => {
  const entries = [
    { path: "Root.java", content: "public class Root {}\n" },
    { path: "Address.java", content: "public class Address {}\n" },
  ];

  it("writes the local, central and end-of-central signatures", () => {
    const zip = createZip(entries, FIXED);

    expect(u32(zip, 0)).toBe(0x04034b50);

    const centralOffset = u32(zip, zip.length - 22 + 16);

    expect(u32(zip, centralOffset)).toBe(0x02014b50);
    expect(u32(zip, zip.length - 22)).toBe(0x06054b50);
  });

  it("records one entry per file in both directories", () => {
    const zip = createZip(entries, FIXED);
    const end = zip.length - 22;

    expect(u16(zip, end + 8)).toBe(entries.length);
    expect(u16(zip, end + 10)).toBe(entries.length);
  });

  it("stores content uncompressed and recoverable", () => {
    const zip = createZip(entries, FIXED);
    const text = new TextDecoder().decode(zip);

    for (const entry of entries) {
      expect(text).toContain(entry.path);
      expect(text).toContain(entry.content.trim());
    }
  });

  it("stores the crc and both sizes for each entry", () => {
    const content = "public class Root {}\n";
    const zip = createZip([{ path: "Root.java", content }], FIXED);
    const expected = crc32(new TextEncoder().encode(content));

    // Local header: crc at +14, compressed at +18, uncompressed at +22.
    expect(u32(zip, 14)).toBe(expected);
    expect(u32(zip, 18)).toBe(content.length);
    expect(u32(zip, 22)).toBe(content.length);
  });

  it("marks names as UTF-8", () => {
    const zip = createZip([{ path: "Ünïcode.cs", content: "x" }], FIXED);

    expect(u16(zip, 6) & 0x0800).toBe(0x0800);
  });

  it("is reproducible for a fixed timestamp", () => {
    expect(createZip(entries, FIXED)).toEqual(createZip(entries, FIXED));
  });

  it("handles an empty archive", () => {
    const zip = createZip([], FIXED);

    expect(zip.length).toBe(22);
    expect(u32(zip, 0)).toBe(0x06054b50);
  });
});
