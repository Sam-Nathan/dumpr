import { router } from 'expo-router';
import { View } from 'react-native';
import {
  checkPushPermission,
  requestPushPermissionAndRegister,
} from '@/features/notifications/register';
import { goBack, PermissionPrimer, SheetContent, toast } from '@/ui';

/** A6 primer for notifications, opened once by `maybeRegisterForPush()` after the first join. */
export default function NotificationsPrimerSheet() {
  return (
    <SheetContent closeButton={false}>
      <View style={{ minHeight: 600 }}>
        <PermissionPrimer
          kind="notifications"
          request={requestPushPermissionAndRegister}
          check={checkPushPermission}
          onGranted={() => {
            toast.show({ message: "You'll hear about invites, mentions and reveals." });
            goBack();
          }}
          onNotNow={() => (router.canGoBack() ? router.back() : undefined)}
        />
      </View>
    </SheetContent>
  );
}
