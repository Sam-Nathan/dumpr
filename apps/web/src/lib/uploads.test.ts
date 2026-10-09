import { describe, expect, it } from 'vitest';
import type { WebUploadItem } from './upload-contract';
import { hasActive, normalizeProgress, summarizeUploads, summaryLabel } from './uploads';

const item = (state: string, progress = 0): WebUploadItem => ({
  id: state + progress,
  name: 'a.jpg',
  state,
  progress,
  previewUrl: '',
});

describe('uploads helpers', () => {
  it('normalises progress', () => {
    expect(normalizeProgress(0.5)).toBe(0.5);
    expect(normalizeProgress(50)).toBe(0.5);
    expect(normalizeProgress(-1)).toBe(0);
    expect(normalizeProgress(NaN)).toBe(0);
    expect(normalizeProgress(250)).toBe(1);
  });
  it('detects active uploads', () => {
    expect(hasActive([item('done'), item('uploading')])).toBe(true);
    expect(hasActive([item('done'), item('failed'), item('duplicate')])).toBe(false);
    expect(hasActive([item('paused')])).toBe(true);
    expect(hasActive([])).toBe(false);
  });
  it('summarises', () => {
    const s = summarizeUploads([
      item('done'),
      item('uploading', 0.5),
      item('queued'),
      item('failed'),
    ]);
    expect(s).toMatchObject({ total: 4, done: 1, active: 2, failed: 1, finished: 1 });
    expect(s.progress).toBeCloseTo((1 + 0.5 + 0 + 1) / 4);
    expect(summaryLabel(s)).toBe('Uploading 3 of 4');
  });
  it('final label', () => {
    expect(summaryLabel(summarizeUploads([item('done'), item('duplicate'), item('failed')]))).toBe(
      '2 added · 1 didn’t upload',
    );
    expect(summaryLabel(summarizeUploads([]))).toBe('');
  });
});
