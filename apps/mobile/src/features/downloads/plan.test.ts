import { describe, expect, it } from 'vitest';
import {
  albumName,
  checkSpace,
  chunk,
  defaultQuality,
  downloadLabel,
  estimateDownload,
  extensionFor,
  formatEta,
  jobStatusLine,
  planBatches,
  progressFraction,
  remainingIds,
  savedKey,
  variantFor,
} from './plan';

describe('batching and resume', () => {
  const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
  it('chunks into batches of 100', () => {
    const b = planBatches(ids, new Set());
    expect(b.map((x) => x.length)).toEqual([100, 100, 50]);
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
  it('skips ids that were already saved (resume) and de-duplicates', () => {
    const saved = new Set(ids.slice(0, 120));
    expect(remainingIds(ids, saved)).toHaveLength(130);
    expect(planBatches(ids, saved).map((x) => x.length)).toEqual([100, 30]);
    expect(remainingIds(['a', 'a', 'b'], new Set())).toEqual(['a', 'b']);
    expect(planBatches(ids, new Set(ids))).toEqual([]);
  });
});

describe('quality, names, extensions', () => {
  it('quality defaults and variants', () => {
    expect(defaultQuality('android')).toBe('high');
    expect(defaultQuality('ios')).toBe('original');
    expect(variantFor('original')).toBe('original');
    expect(variantFor('high')).toBe('display');
  });
  it('extensions: High is always jpg', () => {
    expect(extensionFor('image/heic', 'original')).toBe('heic');
    expect(extensionFor('image/heic', 'high')).toBe('jpg');
    expect(extensionFor(null, 'original')).toBe('jpg');
    expect(extensionFor('image/png', 'original')).toBe('png');
  });
  it('album names per platform, sanitised', () => {
    expect(albumName('android', "Goa '26")).toBe("Dumpr/Goa '26");
    expect(albumName('ios', "Goa '26")).toBe("Dumpr – Goa '26");
    expect(albumName('android', 'a/b:c*')).toBe('Dumpr/a b c');
    expect(albumName('android', '  ')).toBe('Dumpr/Roll');
  });
});

describe('estimates', () => {
  it('uses known bytes for Original and a fixed size for High', () => {
    expect(
      estimateDownload({ count: 10, quality: 'original', knownOriginalBytes: 50_000_000 }).bytes,
    ).toBe(50_000_000);
    expect(estimateDownload({ count: 10, quality: 'original' }).bytes).toBe(40_000_000);
    expect(estimateDownload({ count: 10, quality: 'high' }).bytes).toBe(6_500_000);
  });
  it('time grows with size', () => {
    const e = estimateDownload({ count: 1204, quality: 'original' });
    expect(e.seconds).toBeGreaterThan(60);
    expect(formatEta(30)).toBe('<1 MIN');
    expect(formatEta(14 * 60)).toBe('14 MIN');
    expect(formatEta(80 * 60)).toBe('1 H 20 MIN');
    expect(formatEta(3600)).toBe('1 H');
  });
  it('checks free space with headroom and suggests High', () => {
    const tight = checkSpace({ bytes: 6_800_000_000, freeBytes: 5_000_000_000, count: 1204 });
    expect(tight.fits).toBe(false);
    expect(tight.highWouldFit).toBe(true);
    expect(checkSpace({ bytes: 1_000_000, freeBytes: null, count: 1 }).fits).toBe(true);
    expect(checkSpace({ bytes: 1_000_000_000, freeBytes: 21_000_000_000, count: 1 }).fits).toBe(
      true,
    );
  });
});

describe('labels', () => {
  it('progress and copy', () => {
    expect(progressFraction(62, 100)).toBe(0.62);
    expect(progressFraction(1, 0)).toBe(0);
    expect(jobStatusLine('running', 62, 100)).toBe('1 running · 62%');
    expect(jobStatusLine('paused', 1, 4)).toBe('Paused · 25%');
    expect(jobStatusLine('idle', 0, 0)).toBe('Nothing downloading');
    expect(downloadLabel(1204)).toBe('Download 1,204 photos');
    expect(downloadLabel(1)).toBe('Download 1 photo');
    expect(savedKey({ scope: 'roll', rollId: 'r1', quality: 'high' })).toBe(
      'dumpr.dl.saved.roll.r1.high',
    );
  });
});
