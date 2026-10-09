import { describe, expect, it } from 'vitest';
import { needsProfileSetup, resolveGate } from './profileGate';

const base = {
  authReady: true,
  hasSession: true,
  isGuest: false,
  profileLoading: false,
  profileError: false,
};
const done = { display_name: 'Meera', handle: 'meera', is_guest: false };

describe('auth gate', () => {
  it('needs profile for default names or missing handle', () => {
    expect(
      needsProfileSetup({ display_name: 'New user', handle: 'x' + 'yz', is_guest: false }),
    ).toBe(true);
    expect(needsProfileSetup({ display_name: 'Meera', handle: null, is_guest: false })).toBe(true);
    expect(needsProfileSetup(done)).toBe(false);
    expect(needsProfileSetup({ display_name: 'Guest', handle: null, is_guest: true })).toBe(false);
  });
  it('resolves states', () => {
    expect(resolveGate({ ...base, authReady: false, profile: null })).toBe('loading');
    expect(resolveGate({ ...base, hasSession: false, profile: null })).toBe('signed-out');
    expect(resolveGate({ ...base, isGuest: true, profile: null })).toBe('ready');
    expect(resolveGate({ ...base, profile: done })).toBe('ready');
    expect(resolveGate({ ...base, profile: { ...done, handle: null } })).toBe('needs-profile');
    expect(resolveGate({ ...base, profileLoading: true, profile: undefined })).toBe('loading');
    expect(resolveGate({ ...base, profileError: true, profile: undefined })).toBe('error');
  });
});
