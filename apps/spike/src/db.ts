import * as SQLite from 'expo-sqlite';
import * as Battery from 'expo-battery';

export type EventKind =
  | 'geofence_enter'
  | 'geofence_exit'
  | 'manual_arrive'
  | 'manual_leave'
  | 'breadcrumb'
  | 'regions_registered'
  | 'app_open'
  | 'task_error';

export type Place = { id: number; name: string; lat: number; lon: number; radius: number };

export type LogEvent = {
  id: number;
  ts: number;
  kind: EventKind;
  place_id: number | null;
  place_name: string | null;
  detail: string | null;
  battery: number | null;
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// The geofence task runs in a headless JS context, so it opens the DB itself.
export function getDb() {
  dbPromise ??= init();
  return dbPromise;
}

async function init() {
  const db = await SQLite.openDatabaseAsync('spike.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, radius REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, kind TEXT NOT NULL,
      place_id INTEGER, place_name TEXT, detail TEXT,
      battery REAL, lat REAL, lon REAL, accuracy REAL
    );
  `);
  return db;
}

export async function listPlaces(): Promise<Place[]> {
  const db = await getDb();
  return db.getAllAsync<Place>('SELECT * FROM places ORDER BY id');
}

export async function getPlace(id: number): Promise<Place | null> {
  const db = await getDb();
  return db.getFirstAsync<Place>('SELECT * FROM places WHERE id = ?', id);
}

export async function addPlace(p: Omit<Place, 'id'>) {
  const db = await getDb();
  await db.runAsync('INSERT INTO places (name, lat, lon, radius) VALUES (?, ?, ?, ?)', p.name, p.lat, p.lon, p.radius);
}

export async function updatePlaceRadius(id: number, radius: number) {
  const db = await getDb();
  await db.runAsync('UPDATE places SET radius = ? WHERE id = ?', radius, id);
}

export async function deletePlace(id: number) {
  const db = await getDb();
  await db.runAsync('DELETE FROM places WHERE id = ?', id);
}

export async function listEvents(limit = 200): Promise<LogEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LogEvent>('SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?', limit);
}

export async function listAllEventsAsc(): Promise<LogEvent[]> {
  const db = await getDb();
  return db.getAllAsync<LogEvent>('SELECT * FROM events ORDER BY ts ASC, id ASC');
}

export async function clearEvents() {
  const db = await getDb();
  await db.runAsync('DELETE FROM events');
}

async function batteryLevel(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level : null;
  } catch {
    return null;
  }
}

export async function logEvent(e: {
  kind: EventKind;
  ts?: number;
  place?: Pick<Place, 'id' | 'name'> | null;
  detail?: string;
  lat?: number | null;
  lon?: number | null;
  accuracy?: number | null;
}) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO events (ts, kind, place_id, place_name, detail, battery, lat, lon, accuracy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.ts ?? Date.now(),
    e.kind,
    e.place?.id ?? null,
    e.place?.name ?? null,
    e.detail ?? null,
    await batteryLevel(),
    e.lat ?? null,
    e.lon ?? null,
    e.accuracy ?? null,
  );
}
