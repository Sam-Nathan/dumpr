/** Phone number helpers for A2. Pure, unit-tested. */

export interface Country {
  iso: string;
  name: string;
  /** Dial code without "+". */
  dial: string;
  /** Allowed national-number lengths (digits, no trunk prefix). */
  lengths: readonly number[];
  /** Group sizes for display, e.g. [5, 5] -> "98450 12345". */
  groups: readonly number[];
}

export const COUNTRIES: readonly Country[] = [
  { iso: 'IN', name: 'India', dial: '91', lengths: [10], groups: [5, 5] },
  { iso: 'US', name: 'United States', dial: '1', lengths: [10], groups: [3, 3, 4] },
  { iso: 'GB', name: 'United Kingdom', dial: '44', lengths: [10], groups: [4, 6] },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', lengths: [9], groups: [2, 3, 4] },
  { iso: 'SG', name: 'Singapore', dial: '65', lengths: [8], groups: [4, 4] },
  { iso: 'AU', name: 'Australia', dial: '61', lengths: [9], groups: [3, 3, 3] },
  { iso: 'CA', name: 'Canada', dial: '1', lengths: [10], groups: [3, 3, 4] },
  { iso: 'NP', name: 'Nepal', dial: '977', lengths: [10], groups: [3, 3, 4] },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', lengths: [9], groups: [2, 3, 4] },
  { iso: 'BD', name: 'Bangladesh', dial: '880', lengths: [10], groups: [4, 6] },
];

export const DEFAULT_COUNTRY = COUNTRIES[0] as Country;

export function findCountry(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
}

/** Digits only. */
export function digitsOf(input: string): string {
  return input.replace(/\D+/g, '');
}

/**
 * Clean what was typed or pasted into a national number: strips spaces, a leading "+<dial>" /
 * "00<dial>" if the person pasted an international number, and a single leading trunk "0".
 */
export function nationalDigits(input: string, country: Country): string {
  let d = digitsOf(input);
  const maxLen = Math.max(...country.lengths);
  if (input.trim().startsWith('+') || input.trim().startsWith('00')) {
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith(country.dial)) d = d.slice(country.dial.length);
  } else if (d.length > maxLen && d.startsWith(country.dial)) {
    d = d.slice(country.dial.length);
  }
  if (d.startsWith('0') && d.length > maxLen) d = d.slice(1);
  return d.slice(0, maxLen);
}

/** "9845012345" -> "98450 12345" using the country's grouping. */
export function formatNational(digits: string, country: Country): string {
  const out: string[] = [];
  let i = 0;
  for (const g of country.groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + g));
    i += g;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(' ');
}

export function isValidNational(digits: string, country: Country): boolean {
  return country.lengths.includes(digits.length);
}

/** E.164 string Supabase expects: "+919845012345". */
export function toE164(digits: string, country: Country): string {
  return `+${country.dial}${digits}`;
}

/** Display form: "+91 98450 12345". */
export function formatInternational(digits: string, country: Country): string {
  return `+${country.dial} ${formatNational(digits, country)}`;
}

/** Keep only digits of a pasted OTP and clip to the code length. */
export function sanitizeOtp(input: string, length = 6): string {
  return digitsOf(input).slice(0, length);
}
