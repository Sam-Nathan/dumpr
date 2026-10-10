// Public API of the mobile upload queue (architecture §9). Other features code against exactly this.
//
//   startUploadWorker()            call once from the root layout (idempotent)
//   setUploadQueryClient(qc)       so finished uploads refresh ['roll-photos', id] / ['roll-header', id]
//   enqueueUploads(assets, target) → photo ids (client-generated, the idempotency key)
import { registerUploadBackgroundTask } from './background.ts';
import { startUploadWorker as startWorker } from './worker.ts';

export {
  cancelUpload,
  clearFinishedUploads,
  enqueueUploads,
  retryAllFailed,
  retryUpload,
  setPaused,
  setUploadQueryClient,
  setWifiOnly,
  type EnqueueAsset,
  type UploadItemView,
  type UploadQueueSnapshot,
} from './worker.ts';
export { useRollPendingUploads, useUploadProgress, useUploadQueue } from './hooks.ts';
export type { UploadState, UploadSummary } from '@dumpr/core';

/** Loads the persisted queue, resumes it, follows network changes; registers the background drain. */
export function startUploadWorker(): void {
  startWorker();
  void registerUploadBackgroundTask();
}
