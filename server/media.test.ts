import { describe, expect, it } from 'vitest';
import { GameError } from './errors';
import { OWN_UPLOAD, parseMediaInput, sniffImageType } from './media';

describe('parseMediaInput', () => {
  it('accepts a normal http/https image URL', () => {
    expect(parseMediaInput('https://example.com/a.gif')).toBe('https://example.com/a.gif');
    expect(parseMediaInput('http://example.com/a.png')).toBe('http://example.com/a.png');
  });
  it('accepts one of our own upload paths', () => {
    const path = '/uploads/' + 'a'.repeat(32) + '.png';
    expect(parseMediaInput(path)).toBe(path);
    expect(OWN_UPLOAD.test(path)).toBe(true);
  });
  it('rejects non-http(s) protocols, including javascript: URLs', () => {
    expect(() => parseMediaInput('javascript:alert(1)')).toThrow(GameError);
    expect(() => parseMediaInput('ftp://example.com/a.gif')).toThrow(GameError);
    expect(() => parseMediaInput('data:text/html,<script>1</script>')).toThrow(GameError);
  });
  it('rejects garbage, empty, non-string, and over-long input', () => {
    expect(() => parseMediaInput('not a url')).toThrow(GameError);
    expect(() => parseMediaInput('')).toThrow(GameError);
    expect(() => parseMediaInput(undefined)).toThrow(GameError);
    expect(() => parseMediaInput(123)).toThrow(GameError);
    expect(() => parseMediaInput('https://example.com/' + 'a'.repeat(3000))).toThrow(GameError);
  });
  it('rejects a path that only looks like one of our uploads', () => {
    expect(() => parseMediaInput('/uploads/../../etc/passwd')).toThrow(GameError);
    expect(() => parseMediaInput('/uploads/short.png')).toThrow(GameError);
  });
});

describe('sniffImageType', () => {
  it('identifies real JPEG, PNG, GIF and WebP headers', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({ ext: 'jpg' });
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toEqual({ ext: 'png' });
    expect(sniffImageType(Buffer.from('GIF89a' + '\0'.repeat(6), 'latin1'))).toEqual({ ext: 'gif' });
    const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]);
    expect(sniffImageType(webp)).toEqual({ ext: 'webp' });
  });
  it('rejects a renamed file that is not really an image (e.g. HTML with a .png name)', () => {
    const fakeHtml = Buffer.from('<script>alert(1)</script>'.padEnd(20, ' '), 'utf8');
    expect(sniffImageType(fakeHtml)).toBeNull();
  });
  it('rejects a too-short buffer', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
