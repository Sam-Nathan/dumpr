import { parseFingerprints } from '../../../lib/wellknown';

// Android App Links verification.
// Set ANDROID_SHA256_CERT_FINGERPRINTS (comma list: Play App Signing + upload keys) in the deployment env.
export const dynamic = 'force-static';

export function GET() {
  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.dumpr',
        sha256_cert_fingerprints: parseFingerprints(process.env.ANDROID_SHA256_CERT_FINGERPRINTS),
      },
    },
  ]);
}
