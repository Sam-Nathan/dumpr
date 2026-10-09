import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_KEYS = 5000;
const keyFor = (rollId: string) => `dumpr.imported.${rollId}`;

/** Best-effort memory of what this phone already added to a Roll (filename + capture second). */
export async function loadImported(rollId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(rollId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export async function rememberImported(rollId: string, keys: readonly string[]): Promise<void> {
  try {
    const cur = [...(await loadImported(rollId)), ...keys];
    await AsyncStorage.setItem(keyFor(rollId), JSON.stringify(cur.slice(-MAX_KEYS)));
  } catch {
    // the server dedupes by hash anyway
  }
}
