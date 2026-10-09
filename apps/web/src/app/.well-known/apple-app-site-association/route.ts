// Universal Links. Served as JSON with no file extension (Apple requirement).
// TODO: replace TEAMID with the Apple Developer Team ID.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    applinks: {
      details: [
        {
          // iOS 13+ format
          appIDs: ['TEAMID.app.dumpr'],
          components: [{ '/': '/r/*' }, { '/': '/c/*' }],
          // legacy format for older iOS versions
          appID: 'TEAMID.app.dumpr',
          paths: ['/r/*', '/c/*'],
        },
      ],
    },
  });
}
