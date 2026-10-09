/** Env-driven values for /.well-known association files, with safe placeholders. */

export const PLACEHOLDER_TEAM_ID = 'TEAMID';
export const PLACEHOLDER_FINGERPRINT = 'TODO:SHA256:FINGERPRINT';

export function appleTeamId(env: string | undefined): string {
  const v = env?.trim();
  return v && /^[A-Z0-9]{10}$/i.test(v) ? v.toUpperCase() : PLACEHOLDER_TEAM_ID;
}

/** Comma-separated list -> trimmed non-empty fingerprints; placeholder when none. */
export function parseFingerprints(env: string | undefined): string[] {
  const list = (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [PLACEHOLDER_FINGERPRINT];
}
