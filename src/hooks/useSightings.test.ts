import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useSightings', () => {
  const makeSightingData = (overrides = {}) => ({
    latitude: 45.0,
    longitude: -93.0,
    sightedAt: '2026-04-01T08:00:00Z',
    timePeriod: 'Morning' as const,
    species: 'White-tailed Deer',
    count: 1,
    activity: 'Feeding' as const,
    sightingType: 'LiveAnimal' as const,
    wasOverridden: false,
    photos: [],
    source: 'Manual' as const,
    isPublic: false,
    notes: '',
    ...overrides,
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
  });

  async function getHook() {
    const mod = await import('./useSightings');
    return mod.useSightings;
  }

  it('returns an empty sightings array initially', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    expect(result.current.sightings).toEqual([]);
    expect(typeof result.current.add).toBe('function');
    expect(typeof result.current.update).toBe('function');
    expect(typeof result.current.remove).toBe('function');
  });

  it('returns sightings from pre-existing localStorage data', async () => {
    const existing = {
      id: 'abc-123',
      ...makeSightingData(),
      syncStatus: 'pending',
      clientUpdatedAt: '2026-04-01T08:00:00Z',
      createdAt: '2026-04-01T08:00:00Z',
      updatedAt: '2026-04-01T08:00:00Z',
    };
    localStorage.setItem('scoutlog_sightings', JSON.stringify([existing]));

    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    expect(result.current.sightings).toHaveLength(1);
    expect(result.current.sightings[0].id).toBe('abc-123');
    expect(result.current.sightings[0].species).toBe('White-tailed Deer');
  });

  it('add() creates a sighting and re-renders with updated list', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    expect(result.current.sightings).toHaveLength(0);

    let created: unknown;
    act(() => {
      created = result.current.add(makeSightingData());
    });

    expect(result.current.sightings).toHaveLength(1);
    expect(result.current.sightings[0].species).toBe('White-tailed Deer');
    expect(result.current.sightings[0].syncStatus).toBe('pending');
    expect(result.current.sightings[0].id).toBeDefined();
    expect(created).toEqual(result.current.sightings[0]);
  });

  it('add() assigns id, timestamps, and syncStatus automatically', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    act(() => {
      result.current.add(makeSightingData());
    });

    const sighting = result.current.sightings[0];
    expect(sighting.id).toBeTruthy();
    expect(sighting.createdAt).toBeTruthy();
    expect(sighting.updatedAt).toBeTruthy();
    expect(sighting.clientUpdatedAt).toBeTruthy();
    expect(sighting.syncStatus).toBe('pending');
  });

  it('update() modifies a sighting and re-renders', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    act(() => {
      result.current.add(makeSightingData());
    });

    const id = result.current.sightings[0].id;

    act(() => {
      result.current.update(id, { species: 'Elk', count: 3 });
    });

    expect(result.current.sightings).toHaveLength(1);
    expect(result.current.sightings[0].species).toBe('Elk');
    expect(result.current.sightings[0].count).toBe(3);
  });

  it('update() preserves the id and updates timestamps', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    act(() => {
      result.current.add(makeSightingData());
    });

    const id = result.current.sightings[0].id;
    const originalUpdatedAt = result.current.sightings[0].updatedAt;

    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));

    act(() => {
      result.current.update(id, { notes: 'Updated notes' });
    });

    expect(result.current.sightings[0].id).toBe(id);
    expect(result.current.sightings[0].notes).toBe('Updated notes');
    expect(result.current.sightings[0].updatedAt).not.toBe(originalUpdatedAt);
  });

  it('update() returns undefined for non-existent id', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    let updated: unknown;
    act(() => {
      updated = result.current.update('nonexistent', { species: 'Elk' });
    });

    expect(updated).toBeUndefined();
  });

  it('remove() deletes a sighting and re-renders', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    act(() => {
      result.current.add(makeSightingData({ species: 'Deer' }));
      result.current.add(makeSightingData({ species: 'Elk' }));
    });

    expect(result.current.sightings).toHaveLength(2);

    const idToRemove = result.current.sightings.find(s => s.species === 'Deer')!.id;

    act(() => {
      result.current.remove(idToRemove);
    });

    expect(result.current.sightings).toHaveLength(1);
    expect(result.current.sightings[0].species).toBe('Elk');
  });

  it('remove() returns false for non-existent id', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    let deleted: unknown;
    act(() => {
      deleted = result.current.remove('nonexistent');
    });

    expect(deleted).toBe(false);
  });

  it('sightings are sorted by sightedAt descending', async () => {
    const useSightings = await getHook();
    const { result } = renderHook(() => useSightings());

    act(() => {
      result.current.add(makeSightingData({ species: 'Older', sightedAt: '2026-03-01T08:00:00Z' }));
      result.current.add(makeSightingData({ species: 'Newer', sightedAt: '2026-04-01T08:00:00Z' }));
    });

    expect(result.current.sightings[0].species).toBe('Newer');
    expect(result.current.sightings[1].species).toBe('Older');
  });
});
