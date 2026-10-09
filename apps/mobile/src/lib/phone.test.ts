import { describe, expect, it } from 'vitest';
import { findCountry, formatInternational, formatNational, isValidNational, nationalDigits, sanitizeOtp, toE164 } from './phone';

const IN = findCountry('IN');
const US = findCountry('US');

describe('phone', () => {
  it('cleans typed and pasted numbers', () => {
    expect(nationalDigits('98450 12345', IN)).toBe('9845012345');
    expect(nationalDigits('+91 98450 12345', IN)).toBe('9845012345');
    expect(nationalDigits('0091 9845012345', IN)).toBe('9845012345');
    expect(nationalDigits('09845012345', IN)).toBe('9845012345');
    expect(nationalDigits('919845012345', IN)).toBe('9845012345');
    expect(nationalDigits('98450123456789', IN)).toBe('9845012345');
  });
  it('formats and validates', () => {
    expect(formatNational('9845012345', IN)).toBe('98450 12345');
    expect(formatNational('98450', IN)).toBe('98450');
    expect(formatNational('4155550123', US)).toBe('415 555 0123');
    expect(isValidNational('9845012345', IN)).toBe(true);
    expect(isValidNational('984501234', IN)).toBe(false);
    expect(toE164('9845012345', IN)).toBe('+919845012345');
    expect(formatInternational('9845012345', IN)).toBe('+91 98450 12345');
    expect(findCountry('ZZ').iso).toBe('IN');
  });
  it('sanitizes OTP paste', () => {
    expect(sanitizeOtp('471 923')).toBe('471923');
    expect(sanitizeOtp('Your code: 4719236')).toBe('471923');
  });
});
