import { Directory, Paths } from 'expo-file-system';
import { Image } from 'expo-image';

function dirSize(dir: Directory, depth = 0): number {
  if (depth > 6) return 0;
  let total = 0;
  try {
    for (const entry of dir.list()) {
      if (entry instanceof Directory) total += dirSize(entry, depth + 1);
      else total += entry.size ?? 0;
    }
  } catch {
    // unreadable entries are skipped
  }
  return total;
}

/** Bytes in the app cache folder (image cache, download temp files). Null when unreadable. */
export function cacheBytes(): number | null {
  try {
    return dirSize(Paths.cache);
  } catch {
    return null;
  }
}

/** Clears the image cache and temporary download files. Never touches queued uploads. */
export async function clearCache(): Promise<void> {
  await Image.clearDiskCache().catch(() => undefined);
  await Image.clearMemoryCache().catch(() => undefined);
  try {
    const dl = new Directory(Paths.cache, 'dumpr-dl');
    if (dl.exists) dl.delete();
  } catch {
    // best effort
  }
}
