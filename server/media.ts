import { CONFIG } from './config';
import { GameError } from './errors';

const BAD_URL = "That URL doesn't appear to be a valid image.";

// Our own uploads always look exactly like this (random 32-hex name + safe extension).
export const OWN_UPLOAD = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|gif|webp))$/;

/** Accepts either one of our own upload paths or an http(s) URL. Returns a cleaned string. */
export function parseMediaInput(input: unknown): string {
  if (typeof input !== 'string') throw new GameError(BAD_URL);
  const value = input.trim();
  if (OWN_UPLOAD.test(value)) return value;
  if (!value || value.length > CONFIG.maxUrlLength) throw new GameError(BAD_URL);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GameError(BAD_URL);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new GameError(BAD_URL);
  return url.toString();
}

/** Looks at the first bytes of a file to find out what it REALLY is (never trust the filename). */
export function sniffImageType(b: Buffer): { ext: 'jpg' | 'png' | 'gif' | 'webp' } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png' };
  const head = b.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif' };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp' };
  return null;
}
