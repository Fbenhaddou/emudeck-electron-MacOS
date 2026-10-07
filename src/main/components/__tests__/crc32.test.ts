import { CRC32 } from '../shared/crc32';

describe('CRC32', () => {
  it('matches the standard check value', () => {
    expect(new CRC32().update(Buffer.from('123456789')).digest()).toBe(
      'cbf43926',
    );
  });
  it('is identical when fed in chunks', () => {
    const whole = new CRC32()
      .update(Buffer.from('emulation workspace'))
      .digest();
    const chunked = new CRC32()
      .update(Buffer.from('emulation '))
      .update(Buffer.from('workspace'))
      .digest();
    expect(chunked).toBe(whole);
  });
  it('pads small values to eight digits', () => {
    expect(new CRC32().update(new Uint8Array()).digest()).toBe('00000000');
  });
});
