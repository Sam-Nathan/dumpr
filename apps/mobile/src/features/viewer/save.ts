import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { getSignedUrl } from '../../data/media';
import { AppError } from '../../lib/errors';
import { albumName, extensionFor, saveVariantFor, type SaveVariant } from './helpers';

export type SaveResult = { album: string | null };

/** Current save permission (write-only is enough on iOS and on Android 10+). */
export async function canSaveToGallery(): Promise<boolean> {
  try {
    return (await MediaLibrary.getPermissionsAsync(true)).granted;
  } catch {
    return false;
  }
}

export async function requestSavePermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const r = await MediaLibrary.requestPermissionsAsync(true);
  return { granted: r.granted, canAskAgain: r.canAskAgain };
}

async function download(
  photoId: string,
  variant: SaveVariant,
  mime: string | null,
): Promise<string> {
  const url = await getSignedUrl(photoId, variant);
  if (!url) throw new AppError('downloads_disabled');
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new AppError('unknown');
  const target = `${dir}dumpr-${photoId}.${extensionFor(mime, variant)}`;
  const res = await FileSystem.downloadAsync(url, target);
  if (res.status < 200 || res.status >= 300) throw new AppError('network');
  return res.uri;
}

/**
 * Save one photo to the gallery. Original by default; Android gets the JPG "display" variant for
 * HEIC. Android files into the album "Dumpr/<Roll>", iOS saves to Recents.
 */
export async function savePhotoToGallery(
  photoId: string,
  mime: string | null,
  rollName: string,
): Promise<SaveResult> {
  const variant = saveVariantFor(mime, Platform.OS);
  const uri = await download(photoId, variant, mime);
  try {
    if (Platform.OS === 'android') {
      const asset = await MediaLibrary.createAssetAsync(uri);
      const name = albumName(rollName);
      const album = await MediaLibrary.getAlbumAsync(name);
      if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      else await MediaLibrary.createAlbumAsync(name, asset, false);
      return { album: name };
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    return { album: null };
  } finally {
    void FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

/** Share the (JPG) display version through the system sheet. */
export async function sharePhotoFile(photoId: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new AppError('unknown');
  const uri = await download(photoId, 'display', null);
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share photo' });
  } finally {
    void FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
