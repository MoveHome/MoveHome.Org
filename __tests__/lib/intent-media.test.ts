import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_BYTES, sanitiseListingPhoto } from '@/lib/intent/media';

// MUST-PASS: a photo carrying GPS EXIF is re-encoded without any EXIF, and the
// original is gone once the rendition exists.

// A minimal but genuine EXIF block: IFD0 -> GPS IFD (0x8825) with a real
// latitude/longitude pair, spliced in as an APP1 segment after SOI.
function withGpsExif(jpeg: Buffer): Buffer {
  const gpsOffset = 8 + 2 + 12 + 4;
  const dataOffset = 2 + 4 * 12 + 4;
  const coords = [51, 31, 22, 0, 9, 30];
  const tiff = Buffer.alloc(8 + 18 + dataOffset + 48);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(gpsOffset, 18);

  const ifd = 8 + 18;
  tiff.writeUInt16LE(4, ifd);
  const entry = (index: number, tag: number, type: number, count: number, field: number | string) => {
    const at = ifd + 2 + index * 12;
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (typeof field === 'number') tiff.writeUInt32LE(field, at + 8);
    else tiff.write(field, at + 8, 'latin1');
  };
  entry(0, 0x0001, 2, 2, 'N'); // GPSLatitudeRef
  entry(1, 0x0002, 5, 3, dataOffset); // GPSLatitude
  entry(2, 0x0003, 2, 2, 'W'); // GPSLongitudeRef
  entry(3, 0x0004, 5, 3, dataOffset + 24); // GPSLongitude
  tiff.writeUInt32LE(0, ifd + 2 + 4 * 12);
  coords.forEach((value, index) => {
    tiff.writeUInt32LE(value, ifd + dataOffset + index * 8);
    tiff.writeUInt32LE(1, ifd + dataOffset + index * 8 + 4);
  });

  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
  app1.writeUInt16BE(app1.length - 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

describe('intent media', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'intent-media-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('strips EXIF/GPS by re-encoding and deletes the original', async () => {
    const plain = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#0f0' } })
      .jpeg()
      .toBuffer();
    const original = withGpsExif(plain);

    expect((await sharp(original).metadata()).exif).toBeTruthy();

    const source = join(dir, 'original.jpg');
    await writeFile(source, original);

    const rendition = await sanitiseListingPhoto({ path: source, mime: 'image/jpeg' });
    const meta = await sharp(rendition.data).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeFalsy();
    expect(rendition.data.includes(Buffer.from('Exif\0\0'))).toBe(false);
    expect(existsSync(source)).toBe(false); // the original is gone post-commit
    expect(rendition.bytes).toBe(rendition.data.length);
    expect(rendition.width).toBe(16);
  });

  it('rejects a non-image and still deletes the original', async () => {
    const source = join(dir, 'not-an-image.jpg');
    await writeFile(source, Buffer.from('definitely not a photo'));

    await expect(sanitiseListingPhoto({ path: source, mime: 'image/jpeg' })).rejects.toThrow();
    expect(existsSync(source)).toBe(false);
  });

  it('rejects an image over the size cap', async () => {
    const source = join(dir, 'huge.jpg');
    await writeFile(source, Buffer.alloc(MAX_BYTES + 1));

    await expect(sanitiseListingPhoto({ path: source })).rejects.toThrow(/max/);
  });
});
