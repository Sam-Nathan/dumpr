// Typed access to function secrets. Optional groups (R2, MSG91) report "not configured" instead of crashing.

export function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
}

/** null when any R2 secret is missing → callers answer 503 storage_not_configured. */
export function r2Config(): R2Config | null {
  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: Deno.env.get('R2_ENDPOINT') ?? `https://${accountId}.r2.cloudflarestorage.com`,
  };
}
