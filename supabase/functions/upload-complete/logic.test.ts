import { assertEquals } from 'jsr:@std/assert@1';
import {
  classifyCompleteMultipartError,
  incompleteDetails,
  normalizeMime,
  verifyObjects,
  type HeadResult,
} from './logic.ts';

const MD5 = '0123456789abcdef0123456789abcdef';
const head = (size: number, etag = 'x', contentType: string | null = 'image/jpeg'): HeadResult => ({ size, etag, contentType });
const base = {
  bytes: 1000,
  contentHash: `md5:${MD5}`,
  multipart: false,
  heads: { thumb: head(10), display: head(100), original: head(1000, MD5) },
};

Deno.test('all three present and verified', () => {
  assertEquals(verifyObjects(base), []);
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, original: head(1000, MD5.toUpperCase()) } }), []);
});

Deno.test('reports exactly the missing variants', () => {
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, thumb: null } }), ['thumb']);
  assertEquals(verifyObjects({ ...base, heads: { thumb: null, display: null, original: null } }), ['thumb', 'display', 'original']);
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, display: head(0) } }), ['display']);
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, thumb: head(50 * 1024 * 1024) } }), ['thumb']);
});

Deno.test('single PUT original: size and md5 ETag must match', () => {
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, original: head(999, MD5) } }), ['original']);
  assertEquals(verifyObjects({ ...base, heads: { ...base.heads, original: head(1000, 'deadbeef') } }), ['original']);
});

Deno.test('multipart original: only size is checked', () => {
  assertEquals(verifyObjects({ ...base, multipart: true, heads: { ...base.heads, original: head(1000, 'abc-3') } }), []);
  assertEquals(verifyObjects({ ...base, multipart: true, heads: { ...base.heads, original: head(10, 'abc-3') } }), ['original']);
});

Deno.test('completeMultipart failures', () => {
  assertEquals(classifyCompleteMultipartError(new Error('r2 completeMultipart failed')), 'restart');
  assertEquals(classifyCompleteMultipartError(new Error('r2 POST 404 <Error><Code>NoSuchUpload</Code>')), 'restart');
  assertEquals(classifyCompleteMultipartError(new Error('r2 POST 400 <Error><Code>InvalidPart</Code>')), 'reset_parts');
  assertEquals(classifyCompleteMultipartError(new Error('r2 POST 500 oops')), 'transient');
  assertEquals(classifyCompleteMultipartError('network down'), 'transient');
});

Deno.test('incompleteDetails only carries set flags', () => {
  assertEquals(incompleteDetails(['thumb']), { missing: ['thumb'] });
  assertEquals(incompleteDetails(['original'], { reset_parts: true, restart_multipart: false }), {
    missing: ['original'],
    reset_parts: true,
  });
});

Deno.test('derived variants must be exactly the size their URL was signed for', () => {
  const sized = { ...base, displayBytes: 100, thumbBytes: 10 };
  assertEquals(verifyObjects(sized), []);
  assertEquals(verifyObjects({ ...sized, heads: { ...base.heads, thumb: head(11) } }), ['thumb']);
  assertEquals(verifyObjects({ ...sized, heads: { ...base.heads, display: head(99) } }), ['display']);
  // sizes not recorded (upload started before they were stored): only the upper bounds apply
  assertEquals(verifyObjects({ ...base, displayBytes: null, thumbBytes: null, heads: { ...base.heads, thumb: head(11) } }), []);
});

Deno.test('Content-Type of every stored object is verified', () => {
  const withMime = { ...base, mime: 'image/jpeg' };
  assertEquals(verifyObjects(withMime), []);
  assertEquals(verifyObjects({ ...withMime, heads: { ...base.heads, thumb: head(10, 'x', 'text/html') } }), ['thumb']);
  assertEquals(verifyObjects({ ...withMime, heads: { ...base.heads, display: head(100, 'x', null) } }), ['display']);
  assertEquals(verifyObjects({ ...withMime, heads: { ...base.heads, original: head(1000, MD5, 'text/html') } }), ['original']);
  assertEquals(verifyObjects({ ...withMime, mime: 'image/png' }), ['original']);
  assertEquals(verifyObjects({ ...withMime, mime: 'image/heic', heads: { ...base.heads, original: head(1000, MD5, 'IMAGE/HEIC') } }), []);
  assertEquals(
    verifyObjects({ ...withMime, multipart: true, heads: { ...base.heads, original: head(1000, 'abc-3', 'application/octet-stream') } }),
    ['original'],
  );
  assertEquals(normalizeMime('Image/JPEG; charset=binary'), 'image/jpeg');
  assertEquals(normalizeMime(null), '');
});
