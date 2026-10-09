import { describe, expect, it } from 'vitest';
import { cleanHandle, handleFromName, isValidHandle } from './handle';

describe('handle', () => {
  it('cleans input like the DB check', () => {
    expect(cleanHandle('@Meera.Clicks')).toBe('meera.clicks');
    expect(cleanHandle('meera clicks!')).toBe('meeraclicks');
    expect(cleanHandle('a'.repeat(30))).toHaveLength(24);
  });
  it('validates', () => {
    expect(isValidHandle('meera.clicks')).toBe(true);
    expect(isValidHandle('ab')).toBe(false);
    expect(isValidHandle('Meera')).toBe(false);
  });
  it('suggests from a name', () => {
    expect(handleFromName('Meera Iyer')).toBe('meera.iyer');
    expect(handleFromName('Zoë  Müller')).toBe('zoe.muller');
    expect(handleFromName('A')).toBe('');
  });
});
