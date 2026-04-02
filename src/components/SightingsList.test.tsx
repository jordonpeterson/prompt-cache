import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import SightingsList from './SightingsList';
import { createMockSighting } from '@/test/fixtures';

describe('SightingsList', () => {
  it('renders empty state when no sightings', () => {
    renderWithProviders(<SightingsList sightings={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('No sightings yet')).toBeInTheDocument();
  });

  it('renders list of sighting cards', () => {
    const sightings = [
      createMockSighting({ id: '1', species: 'Whitetail Deer' }),
      createMockSighting({ id: '2', species: 'Elk' }),
    ];
    renderWithProviders(<SightingsList sightings={sightings} onSelect={vi.fn()} />);

    expect(screen.getByText('Whitetail Deer')).toBeInTheDocument();
    expect(screen.getByText('Elk')).toBeInTheDocument();
  });

  it('shows species emoji and name', () => {
    const sightings = [createMockSighting({ species: 'Wild Turkey' })];
    renderWithProviders(<SightingsList sightings={sightings} onSelect={vi.fn()} />);

    expect(screen.getByText('🦃')).toBeInTheDocument();
    expect(screen.getByText('Wild Turkey')).toBeInTheDocument();
  });

  it('shows count badge when count > 1', () => {
    const sightings = [createMockSighting({ count: 3 })];
    renderWithProviders(<SightingsList sightings={sightings} onSelect={vi.fn()} />);

    expect(screen.getByText('x3')).toBeInTheDocument();
  });

  it('does not show count badge when count is 1', () => {
    const sightings = [createMockSighting({ count: 1 })];
    renderWithProviders(<SightingsList sightings={sightings} onSelect={vi.fn()} />);

    expect(screen.queryByText('x1')).not.toBeInTheDocument();
  });

  it('shows sync status indicator - pending is yellow', () => {
    const sightings = [createMockSighting({ syncStatus: 'pending' })];
    const { container } = renderWithProviders(
      <SightingsList sightings={sightings} onSelect={vi.fn()} />
    );

    const indicator = container.querySelector('.bg-yellow-500');
    expect(indicator).toBeInTheDocument();
  });

  it('shows sync status indicator - synced is green', () => {
    const sightings = [createMockSighting({ syncStatus: 'synced' })];
    const { container } = renderWithProviders(
      <SightingsList sightings={sightings} onSelect={vi.fn()} />
    );

    const indicator = container.querySelector('.bg-green-500');
    expect(indicator).toBeInTheDocument();
  });

  it('calls onSelect when card clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const sighting = createMockSighting();
    renderWithProviders(<SightingsList sightings={[sighting]} onSelect={onSelect} />);

    await user.click(screen.getByText('Whitetail Deer'));
    expect(onSelect).toHaveBeenCalledWith(sighting);
  });
});
