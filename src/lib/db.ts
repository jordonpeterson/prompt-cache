import type { Sighting, SightingPhoto, SyncStatus } from '@/types';
import { v4 as uuid } from 'uuid';

const STORAGE_KEY = 'scoutlog_sightings';
const PHOTO_DB_NAME = 'scoutlog_photos';
const PHOTO_STORE = 'photos';

// --- IndexedDB for photo blobs (avoids localStorage size limits) ---

function openPhotoDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePhoto(id: string, dataUrl: string): Promise<string> {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).put(dataUrl, id);
    tx.oncomplete = () => resolve(`idb://${id}`);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPhoto(id: string): Promise<string | null> {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await openPhotoDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Sighting metadata in localStorage (small JSON, no photos) ---

function loadSightingsRaw(): Sighting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSightingsRaw(sightings: Sighting[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sightings));
  } catch (e) {
    console.error('Failed to save sightings to localStorage:', e);
  }
}

// --- Cached snapshot for useSyncExternalStore (must be referentially stable) ---

let cachedSightings: Sighting[] = loadSightingsRaw().sort(
  (a, b) => new Date(b.sightedAt).getTime() - new Date(a.sightedAt).getTime()
);

let listeners: Array<() => void> = [];

function notify() {
  cachedSightings = loadSightingsRaw().sort(
    (a, b) => new Date(b.sightedAt).getTime() - new Date(a.sightedAt).getTime()
  );
  listeners.forEach(fn => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function getAllSightings(): Sighting[] {
  return cachedSightings;
}

export function getSighting(id: string): Sighting | undefined {
  return cachedSightings.find(s => s.id === id);
}

export function createSighting(data: Omit<Sighting, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'clientUpdatedAt'>): Sighting {
  const now = new Date().toISOString();
  const sighting: Sighting = {
    ...data,
    id: uuid(),
    syncStatus: 'pending',
    clientUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const all = loadSightingsRaw();
  all.push(sighting);
  saveSightingsRaw(all);
  notify();
  return sighting;
}

export function updateSighting(id: string, updates: Partial<Sighting>): Sighting | undefined {
  const all = loadSightingsRaw();
  const idx = all.findIndex(s => s.id === id);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    ...updates,
    id,
    updatedAt: now,
    clientUpdatedAt: now,
    syncStatus: 'pending' as SyncStatus,
  };
  saveSightingsRaw(all);
  notify();
  return all[idx];
}

export function deleteSighting(id: string): boolean {
  const all = loadSightingsRaw();
  const toDelete = all.find(s => s.id === id);
  if (!toDelete) return false;
  // Clean up photos from IndexedDB (fire-and-forget)
  toDelete.photos.forEach(p => deletePhoto(p.id).catch(() => {}));
  const filtered = all.filter(s => s.id !== id);
  saveSightingsRaw(filtered);
  notify();
  return true;
}

export function clearAllSightings(): void {
  const all = loadSightingsRaw();
  // Clean up all photos from IndexedDB (fire-and-forget)
  all.forEach(s => s.photos.forEach(p => deletePhoto(p.id).catch(() => {})));
  saveSightingsRaw([]);
  notify();
}

export function addPhotoToSighting(sightingId: string, photo: SightingPhoto): void {
  const all = loadSightingsRaw();
  const idx = all.findIndex(s => s.id === sightingId);
  if (idx === -1) return;
  all[idx].photos.push(photo);
  all[idx].updatedAt = new Date().toISOString();
  saveSightingsRaw(all);
  notify();
}
