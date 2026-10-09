// Persistent upload queue (expo-sqlite). Everything needed to resume an upload after the app is
// killed lives here: prepared file paths, hash, uploaded variants, multipart upload id + parts.
import * as SQLite from 'expo-sqlite';
import type { UploadPartEtag, UploadStateRecord, UploadVariant } from '@dumpr/core';

export interface UploadRow extends UploadStateRecord {
  id: string; // = photo_id
  roll_id: string;
  chapter_id: string | null;
  /** The URI the app handed us. Never modified or deleted. */
  source_uri: string;
  /** Working copy under documentDirectory/uploads/<id>/ (or source_uri if copying failed). */
  local_uri: string;
  file_name: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  content_hash: string | null;
  display_uri: string | null;
  display_bytes: number | null;
  thumb_uri: string | null;
  thumb_bytes: number | null;
  blurhash: string | null;
  attempt: number;
  variants_done: string; // JSON UploadVariant[]
  upload_id: string | null;
  part_size: number | null;
  parts_done: string; // JSON UploadPartEtag[]
  created_at: number;
  updated_at: number;
}

const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openUploadDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('dumpr-uploads.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((row?.user_version ?? 0) < SCHEMA_VERSION) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS upload_items (
          id                TEXT PRIMARY KEY NOT NULL,
          roll_id           TEXT NOT NULL,
          chapter_id        TEXT,
          source_uri        TEXT NOT NULL,
          local_uri         TEXT NOT NULL,
          file_name         TEXT,
          mime              TEXT,
          bytes             INTEGER,
          width             INTEGER,
          height            INTEGER,
          taken_at          TEXT,
          content_hash      TEXT,
          display_uri       TEXT,
          display_bytes     INTEGER,
          thumb_uri         TEXT,
          thumb_bytes       INTEGER,
          blurhash          TEXT,
          state             TEXT NOT NULL,
          attempt           INTEGER NOT NULL DEFAULT 0,
          next_attempt_at   INTEGER,
          error_code        TEXT,
          existing_photo_id TEXT,
          result_status     TEXT,
          pause_reason      TEXT,
          variants_done     TEXT NOT NULL DEFAULT '[]',
          upload_id         TEXT,
          part_size         INTEGER,
          parts_done        TEXT NOT NULL DEFAULT '[]',
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS upload_items_state ON upload_items (state, created_at);
        CREATE INDEX IF NOT EXISTS upload_items_roll ON upload_items (roll_id);
        CREATE TABLE IF NOT EXISTS upload_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    }
    return db;
  })();
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

const COLUMNS: (keyof UploadRow)[] = [
  'id',
  'roll_id',
  'chapter_id',
  'source_uri',
  'local_uri',
  'file_name',
  'mime',
  'bytes',
  'width',
  'height',
  'taken_at',
  'content_hash',
  'display_uri',
  'display_bytes',
  'thumb_uri',
  'thumb_bytes',
  'blurhash',
  'state',
  'attempt',
  'next_attempt_at',
  'error_code',
  'existing_photo_id',
  'result_status',
  'pause_reason',
  'variants_done',
  'upload_id',
  'part_size',
  'parts_done',
  'created_at',
  'updated_at',
];

type Bindable = string | number | null;

export async function loadAllRows(): Promise<UploadRow[]> {
  const db = await openUploadDb();
  return db.getAllAsync<UploadRow>('SELECT * FROM upload_items ORDER BY created_at ASC, id ASC');
}

export async function insertRows(rows: UploadRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await openUploadDb();
  const sql = `INSERT OR REPLACE INTO upload_items (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`;
  await db.withTransactionAsync(async () => {
    for (const r of rows)
      await db.runAsync(
        sql,
        COLUMNS.map((c) => (r[c] ?? null) as Bindable),
      );
  });
}

export async function updateRow(id: string, patch: Partial<UploadRow>): Promise<void> {
  const keys = (Object.keys(patch) as (keyof UploadRow)[]).filter(
    (k) => k !== 'id' && COLUMNS.includes(k),
  );
  if (!keys.length) return;
  const db = await openUploadDb();
  await db.runAsync(
    `UPDATE upload_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => (patch[k] ?? null) as Bindable), id],
  );
}

export async function deleteRows(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openUploadDb();
  await db.runAsync(`DELETE FROM upload_items WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await openUploadDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM upload_settings WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await openUploadDb();
  await db.runAsync('INSERT OR REPLACE INTO upload_settings (key, value) VALUES (?, ?)', [
    key,
    value,
  ]);
}

export function parseJsonArray<T>(s: string | null | undefined): T[] {
  try {
    const v = JSON.parse(s ?? '[]') as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export const parseVariants = (s: string | null | undefined) =>
  parseJsonArray<UploadVariant>(s).filter(
    (v) => v === 'thumb' || v === 'display' || v === 'original',
  );
export const parseParts = (s: string | null | undefined) =>
  parseJsonArray<UploadPartEtag>(s).filter(
    (p) => p && typeof p.n === 'number' && typeof p.etag === 'string',
  );
