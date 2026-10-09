/**
 * Type-only mirror of the web uploader contract owned by the upload engineer
 * (apps/web/src/lib/upload). The UI codes against this; src/lib/web-uploader.ts is the single wiring point.
 */
export interface WebUploadItem {
  id: string;
  name: string;
  /** queued|preparing|initiating|uploading|completing|done|duplicate|failed|blocked|paused */
  state: string;
  progress: number;
  errorCode?: string;
  previewUrl: string;
}

export interface WebUploader {
  add(files: File[], target: { rollId: string }): void;
  subscribe(fn: (items: WebUploadItem[]) => void): () => void;
  retry(id: string): void;
  cancel(id: string): void;
}

export interface WebUploaderOptions {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string>;
}
