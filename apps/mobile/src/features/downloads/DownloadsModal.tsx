import { View } from 'react-native';
import { useSession } from '@/data/session';
import { BottomModal, Button, Text } from '@/ui';
import {
  cancelDownload,
  dismissFinishedDownload,
  pauseDownload,
  resumeDownload,
  useDownloadStore,
} from './job';
import { jobStatusLine, progressFraction } from './plan';

/** Downloads tile detail on the You screen: progress, pause / resume / cancel. */
export function DownloadsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const job = useDownloadStore();
  const { user } = useSession();
  const pct = Math.round(progressFraction(job.done, job.total) * 100);
  const idle = job.status === 'idle' || !job.descriptor;
  return (
    <BottomModal visible={visible} onClose={onClose} title="Downloads">
      {idle ? (
        <Text variant="body" className="pb-4">
          Nothing is downloading. Open a Roll and tap Download to save it to your gallery.
        </Text>
      ) : (
        <View className="pb-2">
          <Text variant="heading" tone="default">
            {job.descriptor?.rollName}
          </Text>
          <Text variant="caption" className="mt-0.5">
            {jobStatusLine(job.status, job.done, job.total)}
          </Text>
          <View className="mt-3 h-3 overflow-hidden rounded-pill bg-ink/10 dark:bg-ink-dark/15">
            <View className="h-3 rounded-pill bg-flash" style={{ width: `${pct}%` }} />
          </View>
          <Text variant="caption" className="mt-2">
            {job.done} of {job.total}
            {job.note ? ` · ${job.note}` : ''}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {job.status === 'running' ? (
              <Button label="Pause" variant="secondary" onPress={pauseDownload} />
            ) : job.status === 'paused' || job.status === 'failed' ? (
              <Button
                label="Resume"
                variant="strong"
                onPress={() => resumeDownload(user?.id ?? null)}
              />
            ) : (
              <Button
                label="Done"
                variant="strong"
                onPress={() => {
                  dismissFinishedDownload();
                  onClose();
                }}
              />
            )}
            {job.status !== 'done' ? (
              <Button label="Cancel download" variant="destructive" onPress={cancelDownload} />
            ) : null}
          </View>
        </View>
      )}
    </BottomModal>
  );
}
