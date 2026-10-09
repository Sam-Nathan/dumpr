/**
 * Single wiring point for the browser uploader.
 * TODO(upload engineer): replace this temporary stand-in with
 *   export { createWebUploader } from './upload';
 * once apps/web/src/lib/upload exists. The stand-in marks every file as paused so the UI is exercisable.
 */
import type { WebUploader, WebUploaderOptions, WebUploadItem } from './upload-contract';

export function createWebUploader(_options: WebUploaderOptions): WebUploader {
  let items: WebUploadItem[] = [];
  const subs = new Set<(items: WebUploadItem[]) => void>();
  const emit = () => subs.forEach((fn) => fn(items));
  return {
    add(files) {
      items = [
        ...items,
        ...files.map((f, i) => ({
          id: `${Date.now()}-${i}-${f.name}`,
          name: f.name,
          state: 'failed',
          progress: 0,
          errorCode: 'storage_not_configured',
          previewUrl: URL.createObjectURL(f),
        })),
      ];
      emit();
    },
    subscribe(fn) {
      subs.add(fn);
      fn(items);
      return () => subs.delete(fn);
    },
    retry() {},
    cancel(id) {
      items = items.filter((i) => i.id !== id);
      emit();
    },
  };
}
