import { describe, expect, it } from 'vitest';
import {
  appleTeamId,
  parseFingerprints,
  PLACEHOLDER_FINGERPRINT,
  PLACEHOLDER_TEAM_ID,
} from './wellknown';

describe('wellknown', () => {
  it('team id', () => {
    expect(appleTeamId('ab12cd34ef')).toBe('AB12CD34EF');
    expect(appleTeamId('')).toBe(PLACEHOLDER_TEAM_ID);
    expect(appleTeamId('bad id!')).toBe(PLACEHOLDER_TEAM_ID);
    expect(appleTeamId(undefined)).toBe(PLACEHOLDER_TEAM_ID);
  });
  it('fingerprints', () => {
    expect(parseFingerprints(' AA:BB , CC:DD,, ')).toEqual(['AA:BB', 'CC:DD']);
    expect(parseFingerprints(undefined)).toEqual([PLACEHOLDER_FINGERPRINT]);
    expect(parseFingerprints(' , ')).toEqual([PLACEHOLDER_FINGERPRINT]);
  });
});
