import { describe, expect, it } from 'vitest';
import { DUMPR_CORE_VERSION } from './index.ts';

describe('@dumpr/core', () => {
  it('exposes a version', () => {
    expect(DUMPR_CORE_VERSION).toBe('0.1.0');
  });
});
