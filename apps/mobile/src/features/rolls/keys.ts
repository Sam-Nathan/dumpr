/**
 * Photo ids from R2 keys. Thumb keys are `t/<crew>/<roll>/<photo>.jpg` (architecture §3), and the
 * read-model RPCs return keys, not ids, for covers and dump stacks.
 */
export function photoIdFromKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const last = key.split('/').pop() ?? '';
  const id = last.replace(/\.[a-z0-9]+$/i, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
