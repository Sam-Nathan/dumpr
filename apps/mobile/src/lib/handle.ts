/** @handle rules mirror the DB check `^[a-z0-9._]{3,24}$` (lower-cased). Pure, unit-tested. */

export const HANDLE_RE = /^[a-z0-9._]{3,24}$/;

/** Lower-case and strip anything the DB would reject (the leading "@" is display only). */
export function cleanHandle(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 24);
}

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

/** First guess for a handle from a display name: "Meera Iyer" -> "meera.iyer". */
export function handleFromName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._]+|[._]+$/g, '');
  return base.length >= 3 ? base.slice(0, 24) : '';
}
