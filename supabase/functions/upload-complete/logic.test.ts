import { assertEquals } from 'jsr:@std/assert@1';
import { classifyCompleteMultipartError, incompleteDetails, verifyObjects, type HeadResult } from './logic.ts';

const MD5 = '0123456789abcdef0123456789abcdef';
const head = (size: number, etag = 'x'): HeadResult => ({ size, etag, contentType: 'image/jpeg' });
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
