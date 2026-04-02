import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock maplibre-gl (WebGL not available in jsdom)
vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(() => ({
      on: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      setStyle: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    GeolocateControl: vi.fn(),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock IndexedDB (simple in-memory implementation)
const idbStore: Record<string, unknown> = {};
const mockIDB = {
  open: vi.fn(() => {
    const req = {
      result: {
        createObjectStore: vi.fn(),
        transaction: vi.fn(() => ({
          objectStore: vi.fn(() => ({
            put: vi.fn((value: unknown, key: string) => { idbStore[key] = value; }),
            get: vi.fn((key: string) => {
              const r = { result: idbStore[key], onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
              setTimeout(() => r.onsuccess?.(), 0);
              return r;
            }),
            delete: vi.fn((key: string) => { delete idbStore[key]; }),
          })),
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
        })),
      },
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    setTimeout(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    }, 0);
    return req;
  }),
};
Object.defineProperty(window, 'indexedDB', { value: mockIDB });

// Mock navigator.geolocation
Object.defineProperty(navigator, 'geolocation', {
  value: {
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  },
});

// Mock crypto.randomUUID
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...globalThis.crypto,
      randomUUID: () => '00000000-0000-0000-0000-000000000000',
    },
  });
}
