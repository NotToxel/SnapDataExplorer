import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('deduplicates conflicting Tailwind classes', () => {
    expect(cn('p-4', 'p-8')).toBe('p-8');
  });

  it('handles falsy values', () => {
    expect(cn(undefined, null, 'foo', false && 'bar')).toBe('foo');
  });
});

describe('safeConvertFileSrc', () => {
  it('returns undefined for empty/null paths', async () => {
    const { safeConvertFileSrc } = await import('./utils');
    expect(safeConvertFileSrc(undefined)).toBeUndefined();
    expect(safeConvertFileSrc(null)).toBeUndefined();
    expect(safeConvertFileSrc('')).toBeUndefined();
  });

  it('preserves existing web and asset URLs', async () => {
    const { safeConvertFileSrc } = await import('./utils');
    expect(safeConvertFileSrc('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
    expect(safeConvertFileSrc('http://asset.localhost/img.jpg')).toBe('http://asset.localhost/img.jpg');
    expect(safeConvertFileSrc('data:image/png;base64,123')).toBe('data:image/png;base64,123');
    expect(safeConvertFileSrc('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    expect(safeConvertFileSrc('asset://localhost/foo.jpg')).toBe('asset://localhost/foo.jpg');
  });

  it('strips Windows UNC prefix \\\\?\\ before converting', async () => {
    const { safeConvertFileSrc } = await import('./utils');
    const result = safeConvertFileSrc('\\\\?\\C:\\Users\\photos\\pic.jpg');
    expect(result).toBe('asset://localhost/C%3A%5CUsers%5Cphotos%5Cpic.jpg');
  });

  it('handles standard Unix / macOS paths', async () => {
    const { safeConvertFileSrc } = await import('./utils');
    const result = safeConvertFileSrc('/Users/john/photos/pic.jpg');
    expect(result).toBe('asset://localhost/%2FUsers%2Fjohn%2Fphotos%2Fpic.jpg');
  });
});

