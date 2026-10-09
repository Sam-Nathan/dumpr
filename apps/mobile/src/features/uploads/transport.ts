// Mobile IO for the shared pipeline (@dumpr/core runUpload): Edge Function calls via fetch and R2
// PUTs via expo-file-system's native uploader (streams from disk, reports progress, returns headers).
import {
  UploadError,
  errorFromResponse,
  type PartRange,
  type PresignedPut,
  type UploadCompleteRequest,
  type UploadCompleteResponse,
  type UploadInitRequest,
  type UploadInitResponse,
  type UploadTransport,
  type UploadVariant,
} from '@dumpr/core';
import { File, FileMode, Paths, UploadType } from 'expo-file-system';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config.ts';
import { supabase } from '../../lib/supabase.ts';

const FN_TIMEOUT_MS = 30_000;

async function accessToken(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
  } catch {
    // fall through
  }
  throw new UploadError('not_authenticated');
}

async function callFunction<T>(name: string, body: unknown, signal: AbortSignal): Promise<T> {
  const token = await accessToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FN_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    if (signal.aborted) throw new UploadError('cancelled');
    throw new UploadError(ctrl.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) throw errorFromResponse(res.status, parsed);
  return parsed as T;
}

function header(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v;
  return null;
}

async function putFile(
  uri: string,
  url: string,
  headers: Record<string, string>,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<{ etag: string | null }> {
  let result;
  try {
    result = await new File(uri).upload(url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      onProgress: ({ bytesSent }) => onProgress(bytesSent),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new UploadError('cancelled');
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such file|not exist|ENOENT|couldn.t be opened/i.test(msg))
      throw new UploadError('file_missing');
    throw new UploadError('network', { message: msg });
  }
  if (result.status >= 200 && result.status < 300) return { etag: header(result.headers, 'etag') };
  // Expired presigned URL (SigV4 → 403): the next attempt re-inits for fresh URLs.
  if (result.status === 403) throw new UploadError('url_expired', { status: 403 });
  throw new UploadError('put_failed', { status: result.status });
}

export interface ItemFiles {
  id: string;
  local_uri: string;
  display_uri: string;
  thumb_uri: string;
}

export function createMobileTransport(files: ItemFiles, signal: AbortSignal): UploadTransport {
  const uriFor = (v: UploadVariant) =>
    v === 'thumb' ? files.thumb_uri : v === 'display' ? files.display_uri : files.local_uri;
  return {
    init: (req: UploadInitRequest) => callFunction<UploadInitResponse>('upload-init', req, signal),
    complete: (req: UploadCompleteRequest) =>
      callFunction<UploadCompleteResponse>('upload-complete', req, signal),
    putVariant: (v: UploadVariant, target: PresignedPut, onProgress) =>
      putFile(uriFor(v), target.url, target.headers, onProgress, signal),
    async putPart(part: PartRange, url: string, onProgress) {
      // Copy the byte range into a temp file and stream it with the native uploader.
      const tmp = new File(Paths.cache, `dumpr-part-${files.id}-${part.n}.bin`);
      try {
        const handle = new File(files.local_uri).open(FileMode.ReadOnly);
        let bytes: Uint8Array;
        try {
          handle.offset = part.start;
          bytes = handle.readBytes(part.end - part.start);
        } finally {
          handle.close();
        }
        if (bytes.length !== part.end - part.start) throw new UploadError('file_missing');
        if (tmp.exists) tmp.delete();
        tmp.create();
        tmp.write(bytes);
      } catch (e) {
        if (e instanceof UploadError) throw e;
        throw new UploadError('file_missing', {
          message: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        return await putFile(tmp.uri, url, {}, onProgress, signal);
      } finally {
        try {
          tmp.delete();
        } catch {
          // ignore
        }
      }
    },
  };
}
