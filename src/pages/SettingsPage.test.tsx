import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import SettingsPage from './SettingsPage';
import type { Sighting } from '@/types';

const mockSighting = (overrides: Partial<Sighting> = {}): Sighting => ({
  id: 'sight-1',
  latitude: 40.0,
  longitude: -90.0,
  sightedAt: '2026-03-15T08:00:00Z',
  timePeriod: 'Morning',
  species: 'White-tailed Deer',
  count: 1,
  activity: 'Feeding',
  sightingType: 'LiveAnimal',
  wasOverridden: false,
  photos: [],
  notes: '',
  source: 'Manual',
  isPublic: false,
  syncStatus: 'pending',
  clientUpdatedAt: '2026-03-15T08:00:00Z',
  createdAt: '2026-03-15T08:00:00Z',
  updatedAt: '2026-03-15T08:00:00Z',
  ...overrides,
});

const { mockClearAllSightings } = vi.hoisted(() => ({
  mockClearAllSightings: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getAllSightings: vi.fn(() => []),
  subscribe: vi.fn(() => vi.fn()),
  createSighting: vi.fn(),
  updateSighting: vi.fn(),
  deleteSighting: vi.fn(),
  clearAllSightings: mockClearAllSightings,
  savePhoto: vi.fn(),
}));

// Access the mock to control return values
import { getAllSightings } from '@/lib/db';

beforeEach(() => {
  vi.clearAllMocks();
  (getAllSightings as ReturnType<typeof vi.fn>).mockReturnValue([]);
});

describe('SettingsPage', () => {
  it('renders Settings heading', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows sync status section with online indicator', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Sync Status')).toBeInTheDocument();
    // jsdom navigator.onLine defaults to true
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('shows sighting count and pending sync count', () => {
    (getAllSightings as ReturnType<typeof vi.fn>).mockReturnValue([
      mockSighting({ id: '1', syncStatus: 'pending' }),
      mockSighting({ id: '2', syncStatus: 'synced' }),
      mockSighting({ id: '3', syncStatus: 'pending' }),
    ]);

    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('3 total sightings')).toBeInTheDocument();
    expect(screen.getByText('2 pending sync')).toBeInTheDocument();
  });

  it('shows account section with Sign In button', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Sign In (Coming Soon)')).toBeInTheDocument();
  });

  it('shows subscription section with Free plan', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('Export Data button creates and triggers download', () => {
    const mockClick = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const mockCreateElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement;
      return originalCreateElement(tag);
    });
    const mockCreateObjectURL = vi.fn(() => 'blob:test');
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    (getAllSightings as ReturnType<typeof vi.fn>).mockReturnValue([
      mockSighting({ id: '1' }),
    ]);

    try {
      renderWithProviders(<SettingsPage />);
      fireEvent.click(screen.getByText('Export Data (JSON)'));

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    } finally {
      mockCreateElement.mockRestore();
    }
  });

  it('Delete All Data button calls clearAllSightings after confirm', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<SettingsPage />);
    fireEvent.click(screen.getByText('Delete All Data'));

    expect(window.confirm).toHaveBeenCalledWith('Delete all sightings? This cannot be undone.');
    expect(mockClearAllSightings).toHaveBeenCalled();
  });

  it('Delete All Data does not call clearAllSightings when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderWithProviders(<SettingsPage />);
    fireEvent.click(screen.getByText('Delete All Data'));

    expect(mockClearAllSightings).not.toHaveBeenCalled();
  });

  it('renders temperature unit select', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Temperature Unit')).toBeInTheDocument();
    const select = screen.getByDisplayValue('°F');
    expect(select).toBeInTheDocument();
  });
});
