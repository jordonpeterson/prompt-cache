import { describe, it, expect } from 'vitest';
import { SPECIES_LIST, getSpeciesInfo, getSpeciesColor } from './species';

describe('SPECIES_LIST', () => {
  it('contains expected species entries', () => {
    expect(SPECIES_LIST.length).toBeGreaterThan(0);
    const names = SPECIES_LIST.map(s => s.name);
    expect(names).toContain('Whitetail Deer');
    expect(names).toContain('Elk');
    expect(names).toContain('Wild Turkey');
    expect(names).toContain('Unknown');
    expect(names).toContain('Other');
  });

  it('each entry has name, color, and emoji', () => {
    for (const species of SPECIES_LIST) {
      expect(species.name).toBeTruthy();
      expect(species.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(species.emoji).toBeTruthy();
    }
  });
});

describe('getSpeciesInfo', () => {
  it('returns correct info for a known species', () => {
    const info = getSpeciesInfo('Whitetail Deer');
    expect(info).toEqual({ name: 'Whitetail Deer', color: '#8B4513', emoji: '🦌' });
  });

  it('returns correct info for another known species', () => {
    const info = getSpeciesInfo('Black Bear');
    expect(info).toEqual({ name: 'Black Bear', color: '#2F2F2F', emoji: '🐻' });
  });

  it('returns fallback for unknown species name', () => {
    const info = getSpeciesInfo('Unicorn');
    expect(info).toEqual({ name: 'Unicorn', color: '#9E9E9E', emoji: '🐾' });
  });

  it('returns the "Unknown" entry when queried', () => {
    const info = getSpeciesInfo('Unknown');
    expect(info).toEqual({ name: 'Unknown', color: '#9E9E9E', emoji: '❓' });
  });

  it('is case-sensitive', () => {
    const info = getSpeciesInfo('whitetail deer');
    expect(info.color).toBe('#9E9E9E'); // fallback
  });
});

describe('getSpeciesColor', () => {
  it('returns correct color for known species', () => {
    expect(getSpeciesColor('Elk')).toBe('#CD853F');
    expect(getSpeciesColor('Duck')).toBe('#228B22');
  });

  it('returns fallback color for unknown species', () => {
    expect(getSpeciesColor('Dragon')).toBe('#9E9E9E');
  });
});
