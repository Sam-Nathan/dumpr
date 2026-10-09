import { appleTeamId } from '../../../lib/wellknown';

// Universal Links. Served as JSON with no file extension (Apple requirement).
// Set APPLE_TEAM_ID (10 chars) in the deployment env; until then a placeholder is served.
export const dynamic = 'force-static';

export function GET() {
  const appId = `${appleTeamId(process.env.APPLE_TEAM_ID)}.app.dumpr`;
  return Response.json({
    applinks: {
      details: [
        {
          // iOS 13+ format
          appIDs: [appId],
          components: [{ '/': '/r/*' }, { '/': '/c/*' }],
          // legacy format for older iOS versions
          appID: appId,
          paths: ['/r/*', '/c/*'],
        },
      ],
    },
  });
}
