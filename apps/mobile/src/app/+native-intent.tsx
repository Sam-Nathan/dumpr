import { rewriteIncomingPath } from '../lib/deeplinks';

/**
 * expo-router hook for every incoming URL (cold start and warm): maps
 * https://dumpr.app/r/<code>, /c/<code> and dumpr://r/<code> to the A4 route `/invite/<code>`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return rewriteIncomingPath(path);
  } catch {
    return path;
  }
}
