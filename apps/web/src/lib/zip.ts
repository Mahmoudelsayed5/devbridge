/**
 * A minimal, dependency-free ZIP writer.
 *
 * Java and C# emit one file per type, and asking a developer to click
 * "download" seven times is not a usable result. Entries are STORED
 * (uncompressed): generated source is small, every unzip tool reads stored
 * entries, and it keeps this file short enough to audit.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

/** Bit 11 tells readers the file name is UTF-8 rather than CP437. */
const UTF8_NAME_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let c = i;

    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c >>> 0;
  }

  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed time and date, which is what the ZIP format stores. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);

  const packedDate =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9);

  return { time, date: packedDate };
}

class ByteWriter {
  private readonly chunks: number[] = [];

  u16(value: number): this {
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff);

    return this;
  }

  u32(value: number): this {
    this.chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );

    return this;
  }

  bytes(value: Uint8Array): this {
    for (const byte of value) {
      this.chunks.push(byte);
    }

    return this;
  }

  get length(): number {
    return this.chunks.length;
  }

  // Pinned to ArrayBuffer (rather than the wider ArrayBufferLike) so the
  // result is directly usable as a BlobPart.
  toUint8Array(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.chunks);
  }
}

export interface ZipEntry {
  readonly path: string;
  readonly content: string;
}

/**
 * Builds a ZIP archive containing `entries`.
 *
 * @param at timestamp recorded for every entry; pass a fixed date to make the
 * output byte-for-byte reproducible, which is what the tests rely on.
 */
export function createZip(
  entries: readonly ZipEntry[],
  at: Date = new Date(),
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(at);

  const local = new ByteWriter();
  const central = new ByteWriter();

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const checksum = crc32(data);
    const offset = local.length;

    local
      .u32(LOCAL_HEADER)
      .u16(20)
      .u16(UTF8_NAME_FLAG)
      .u16(0) // stored
      .u16(time)
      .u16(date)
      .u32(checksum)
      .u32(data.length)
      .u32(data.length)
      .u16(name.length)
      .u16(0)
      .bytes(name)
      .bytes(data);

    central
      .u32(CENTRAL_HEADER)
      .u16(20)
      .u16(20)
      .u16(UTF8_NAME_FLAG)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(checksum)
      .u32(data.length)
      .u32(data.length)
      .u16(name.length)
      .u16(0) // extra
      .u16(0) // comment
      .u16(0) // disk
      .u16(0) // internal attributes
      .u32(0) // external attributes
      .u32(offset)
      .bytes(name);
  }

  const centralOffset = local.length;
  const centralBytes = central.toUint8Array();

  const end = new ByteWriter()
    .u32(END_OF_CENTRAL)
    .u16(0)
    .u16(0)
    .u16(entries.length)
    .u16(entries.length)
    .u32(centralBytes.length)
    .u32(centralOffset)
    .u16(0);

  const localBytes = local.toUint8Array();
  const endBytes = end.toUint8Array();

  const out = new Uint8Array(
    localBytes.length + centralBytes.length + endBytes.length,
  );

  out.set(localBytes, 0);
  out.set(centralBytes, localBytes.length);
  out.set(endBytes, localBytes.length + centralBytes.length);

  return out;
}
