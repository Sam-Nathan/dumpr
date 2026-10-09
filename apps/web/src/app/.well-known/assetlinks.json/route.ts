// Android App Links verification.
// TODO: replace the placeholder with the SHA-256 fingerprint(s) of the Play App Signing / upload key.
export const dynamic = 'force-static';

export function GET() {
  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.dumpr',
        sha256_cert_fingerprints: ['TODO:SHA256:FINGERPRINT'],
      },
    },
  ]);
}
