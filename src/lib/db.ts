import type { Sighting, SightingPhoto, SyncStatus } from '@/types';
import { v4 as uuid } from 'uuid';

// In-memory storage for web (SQLite for Capacitor native will be added later)
// This provides the same API but uses localStorage for persistence in the browser
const STORAGE_KEY = 'scoutlog_sightings';

function loadSightings(): Sighting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSightings(sightings: Sighting[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sightings));
}

let listeners: Array<() => void> = [];

function notify() {
  listeners.forEach(fn => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

export function getAllSightings(): Sighting[] {
  return loadSightings().sort(
    (a, b) => new Date(b.sightedAt).getTime() - new Date(a.sightedAt).getTime()
  );
}

export function getSighting(id: string): Sighting | undefined {
  return loadSightings().find(s => s.id === id);
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
  const all = loadSightings();
  all.push(sighting);
  saveSightings(all);
  notify();
  return sighting;
}

export function updateSighting(id: string, updates: Partial<Sighting>): Sighting | undefined {
  const all = loadSightings();
  const idx = all.findIndex(s => s.id === id);
  if (idx === -1) return undefined;
  const now = new Date().toISOString();
  all[idx] = {
    ...all[idx],
    ...updates,
    id, // preserve id
    updatedAt: now,
    clientUpdatedAt: now,
    syncStatus: 'pending' as SyncStatus,
  };
  saveSightings(all);
  notify();
  return all[idx];
}

export function deleteSighting(id: string): boolean {
  const all = loadSightings();
  const filtered = all.filter(s => s.id !== id);
  if (filtered.length === all.length) return false;
  saveSightings(filtered);
  notify();
  return true;
}

export function addPhotoToSighting(sightingId: string, photo: SightingPhoto): void {
  const all = loadSightings();
  const idx = all.findIndex(s => s.id === sightingId);
  if (idx === -1) return;
  all[idx].photos.push(photo);
  all[idx].updatedAt = new Date().toISOString();
  saveSightings(all);
  notify();
}
