// Best-effort background drain: the OS wakes the app every ~15+ min (expo-background-task) and we
// run the queue for up to ~25 s. Skipped in Expo Go (no background tasks there); never throws.
import * as BackgroundTask from 'expo-background-task';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as TaskManager from 'expo-task-manager';
import { drainFor } from './worker.ts';

export const UPLOAD_DRAIN_TASK = 'dumpr-upload-drain';

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// defineTask must run at module scope (before the app registers / the OS launches the task).
if (!inExpoGo) {
  try {
    if (!TaskManager.isTaskDefined(UPLOAD_DRAIN_TASK)) {
      TaskManager.defineTask(UPLOAD_DRAIN_TASK, async () => {
        try {
          await drainFor(25_000);
          return BackgroundTask.BackgroundTaskResult.Success;
        } catch {
          return BackgroundTask.BackgroundTaskResult.Failed;
        }
      });
    }
  } catch {
    // native module missing: background drain simply does not run
  }
}

let registered = false;

export async function registerUploadBackgroundTask(): Promise<void> {
  if (inExpoGo || registered) return;
  registered = true;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(UPLOAD_DRAIN_TASK)) return;
    await BackgroundTask.registerTaskAsync(UPLOAD_DRAIN_TASK, { minimumInterval: 15 });
  } catch {
    // unsupported here (simulator, restricted); foreground uploads still work
  }
}
