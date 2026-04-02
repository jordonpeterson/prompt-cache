import type { Sighting } from '@/types';

export function createMockSighting(overrides?: Partial<Sighting>): Sighting {
  return {
    id: '1',
    latitude: 39.8283,
    longitude: -98.5795,
    sightedAt: '2026-03-15T08:30:00Z',
    timePeriod: 'Morning',
    species: 'Whitetail Deer',
    count: 1,
    activity: 'Feeding',
    sightingType: 'LiveAnimal',
    wasOverridden: false,
    photos: [],
    source: 'Manual',
    isPublic: false,
    syncStatus: 'pending',
    clientUpdatedAt: '2026-03-15T08:30:00Z',
    createdAt: '2026-03-15T08:30:00Z',
    updatedAt: '2026-03-15T08:30:00Z',
    ...overrides,
  };
}
