/* eslint-disable no-bitwise -- CRC32 is bitwise by definition. */
const table = (() => {
  const values = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    values[index] = value >>> 0;
  }
  return values;
})();

/** Incremental IEEE CRC32 (zlib/Redump), returned as 8 lowercase hex digits. */
export class CRC32 {
  private value = 0xffffffff;

  update(bytes: {
    readonly length: number;
    readonly [index: number]: number;
  }): this {
    let { value } = this;
    for (let index = 0; index < bytes.length; index += 1)
      value = table[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
    this.value = value;
    return this;
  }

  digest(): string {
    return ((this.value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  }
}
