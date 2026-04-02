import { useSyncExternalStore, useCallback } from 'react';
import { getAllSightings, subscribe, createSighting, updateSighting, deleteSighting } from '@/lib/db';
import type { Sighting } from '@/types';

export function useSightings() {
  const sightings = useSyncExternalStore(subscribe, getAllSightings);

  const add = useCallback(
    (data: Omit<Sighting, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'clientUpdatedAt'>) => {
      return createSighting(data);
    },
    []
  );

  const update = useCallback(
    (id: string, updates: Partial<Sighting>) => {
      return updateSighting(id, updates);
    },
    []
  );

  const remove = useCallback(
    (id: string) => {
      return deleteSighting(id);
    },
    []
  );

  return { sightings, add, update, remove };
}
