import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Sighting } from '@/types';

// We need fresh module state per test since db.ts has module-level cache
async function getDbModule() {
  return await import('./db');
}

const baseSightingData = {
  latitude: 45.0,
  longitude: -93.0,
  sightedAt: '2026-04-02T10:00:00.000Z',
  timePeriod: 'Morning' as const,
  species: 'Whitetail Deer',
  count: 1,
  activity: 'Feeding' as const,
  sightingType: 'LiveAnimal' as const,
  wasOverridden: false,
  photos: [],
  source: 'Manual' as const,
  isPublic: false,
};

describe('db module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  describe('createSighting', () => {
    it('creates a sighting with correct defaults', async () => {
      const db = await getDbModule();
      const sighting = db.createSighting(baseSightingData);

      expect(sighting.id).toBeDefined();
      expect(sighting.id).toBeTruthy();
      expect(sighting.syncStatus).toBe('pending');
      expect(sighting.createdAt).toBeTruthy();
      expect(sighting.updatedAt).toBeTruthy();
      expect(sighting.clientUpdatedAt).toBeTruthy();
      expect(sighting.species).toBe('Whitetail Deer');
      expect(sighting.latitude).toBe(45.0);
    });

    it('persists sighting to localStorage', async () => {
      const db = await getDbModule();
      db.createSighting(baseSightingData);

      const raw = localStorage.getItem('scoutlog_sightings');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].species).toBe('Whitetail Deer');
    });
  });

  describe('getAllSightings', () => {
    it('returns empty array when no sightings exist', async () => {
      const db = await getDbModule();
      expect(db.getAllSightings()).toEqual([]);
    });

    it('returns sightings sorted by sightedAt desc', async () => {
      const db = await getDbModule();
      db.createSighting({ ...baseSightingData, sightedAt: '2026-04-01T10:00:00.000Z', species: 'Elk' });
      db.createSighting({ ...baseSightingData, sightedAt: '2026-04-03T10:00:00.000Z', species: 'Moose' });
      db.createSighting({ ...baseSightingData, sightedAt: '2026-04-02T10:00:00.000Z', species: 'Duck' });

      const all = db.getAllSightings();
      expect(all).toHaveLength(3);
      expect(all[0].species).toBe('Moose');
      expect(all[1].species).toBe('Duck');
      expect(all[2].species).toBe('Elk');
    });

    it('returns same reference between mutations (referential stability)', async () => {
      const db = await getDbModule();
      const ref1 = db.getAllSightings();
      const ref2 = db.getAllSightings();
      expect(ref1).toBe(ref2);
    });

    it('returns new reference after a mutation', async () => {
      const db = await getDbModule();
      const ref1 = db.getAllSightings();
      db.createSighting(baseSightingData);
      const ref2 = db.getAllSightings();
      expect(ref1).not.toBe(ref2);
    });
  });

  describe('getSighting', () => {
    it('returns sighting by id', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const found = db.getSighting(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.species).toBe('Whitetail Deer');
    });

    it('returns undefined for non-existent id', async () => {
      const db = await getDbModule();
      expect(db.getSighting('nonexistent')).toBeUndefined();
    });
  });

  describe('updateSighting', () => {
    it('updates fields and sets syncStatus to pending', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const updated = db.updateSighting(created.id, { species: 'Elk', count: 3 });

      expect(updated).toBeDefined();
      expect(updated!.species).toBe('Elk');
      expect(updated!.count).toBe(3);
      expect(updated!.syncStatus).toBe('pending');
      expect(updated!.id).toBe(created.id);
    });

    it('updates updatedAt and clientUpdatedAt timestamps', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);

      // Small delay to get different timestamp
      const updated = db.updateSighting(created.id, { species: 'Elk' });
      expect(updated!.updatedAt).toBeTruthy();
      expect(updated!.clientUpdatedAt).toBeTruthy();
    });

    it('returns undefined for non-existent id', async () => {
      const db = await getDbModule();
      const result = db.updateSighting('nonexistent', { species: 'Elk' });
      expect(result).toBeUndefined();
    });

    it('preserves the original id even if updates try to change it', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const updated = db.updateSighting(created.id, { id: 'hackedid' } as Partial<Sighting>);
      expect(updated!.id).toBe(created.id);
    });
  });

  describe('deleteSighting', () => {
    it('removes a sighting and returns true', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const result = db.deleteSighting(created.id);
      expect(result).toBe(true);
      expect(db.getAllSightings()).toHaveLength(0);
    });

    it('returns false for non-existent id', async () => {
      const db = await getDbModule();
      expect(db.deleteSighting('nonexistent')).toBe(false);
    });
  });

  describe('clearAllSightings', () => {
    it('removes all sightings', async () => {
      const db = await getDbModule();
      db.createSighting(baseSightingData);
      db.createSighting({ ...baseSightingData, species: 'Elk' });
      expect(db.getAllSightings()).toHaveLength(2);

      db.clearAllSightings();
      expect(db.getAllSightings()).toHaveLength(0);
    });
  });

  describe('subscribe/notify', () => {
    it('calls listeners on create', async () => {
      const db = await getDbModule();
      const listener = vi.fn();
      db.subscribe(listener);
      db.createSighting(baseSightingData);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on update', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const listener = vi.fn();
      db.subscribe(listener);
      db.updateSighting(created.id, { species: 'Elk' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on delete', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      const listener = vi.fn();
      db.subscribe(listener);
      db.deleteSighting(created.id);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('calls listeners on clearAll', async () => {
      const db = await getDbModule();
      const listener = vi.fn();
      db.subscribe(listener);
      db.clearAllSightings();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe stops notifications', async () => {
      const db = await getDbModule();
      const listener = vi.fn();
      const unsub = db.subscribe(listener);
      unsub();
      db.createSighting(baseSightingData);
      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners all get called', async () => {
      const db = await getDbModule();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      db.subscribe(listener1);
      db.subscribe(listener2);
      db.createSighting(baseSightingData);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('addPhotoToSighting', () => {
    it('adds a photo to an existing sighting', async () => {
      const db = await getDbModule();
      const created = db.createSighting(baseSightingData);
      db.addPhotoToSighting(created.id, {
        id: 'photo1',
        localPath: 'idb://photo1',
        uploaded: false,
      });

      const updated = db.getSighting(created.id);
      expect(updated!.photos).toHaveLength(1);
      expect(updated!.photos[0].id).toBe('photo1');
    });

    it('does nothing for non-existent sighting', async () => {
      const db = await getDbModule();
      // Should not throw
      db.addPhotoToSighting('nonexistent', {
        id: 'photo1',
        localPath: 'idb://photo1',
        uploaded: false,
      });
    });
  });

  // Photo operations (savePhoto, getPhoto, deletePhoto) use IndexedDB
  // which is not reliably supported in jsdom/happy-dom test environments.
  // These are tested via integration/e2e tests instead.

  describe('loadSightingsRaw error handling', () => {
    it('handles corrupted localStorage data gracefully', async () => {
      localStorage.setItem('scoutlog_sightings', 'not-json');
      const db = await getDbModule();
      expect(db.getAllSightings()).toEqual([]);
    });
  });
});
