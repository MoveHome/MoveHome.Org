// Listing photo handling: bound the size, verify the bytes really are an image,
// re-encode through sharp (a fresh JPEG carries no EXIF block at all, so GPS is
// gone) and then delete the original — the rendition is the only copy that
// survives the request.

import { readFile, stat, unlink } from 'node:fs/promises';
import sharp from 'sharp';

export const MAX_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface Rendition {
  data: Buffer;
  mime: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

export async function sanitiseListingPhoto(input: { path: string; mime?: string }): Promise<Rendition> {
  const { size } = await stat(input.path);
  if (size > MAX_BYTES) {
    throw new Error(`photo rejected: ${size} bytes is over the ${MAX_BYTES} byte max`);
  }
  if (input.mime && !ALLOWED_MIME.includes(input.mime as (typeof ALLOWED_MIME)[number])) {
    throw new Error(`photo rejected: unsupported mime ${input.mime}`);
  }

  try {
    const original = await readFile(input.path);
    const meta = await sharp(original).metadata();
    // trust the bytes, not the declared mime
    if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') {
      throw new Error(`photo rejected: unsupported image format ${meta.format ?? 'unknown'}`);
    }

    const data = await sharp(original).rotate().jpeg({ quality: 82 }).toBuffer();
    const out = await sharp(data).metadata();
    if (out.exif) throw new Error('photo rejected: exif survived the re-encode');

    return {
      data,
      mime: 'image/jpeg',
      width: out.width ?? 0,
      height: out.height ?? 0,
      bytes: data.length
    };
  } finally {
    // the original is deleted either way: raw capture bytes never outlive the request
    await unlink(input.path).catch(() => undefined);
  }
}
