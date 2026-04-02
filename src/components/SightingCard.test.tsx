import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import SightingCard from './SightingCard';
import { createMockSighting } from '@/test/fixtures';

const defaultProps = {
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

describe('SightingCard', () => {
  it('renders species name, emoji, date/time', () => {
    const sighting = createMockSighting();
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    expect(screen.getByText('Whitetail Deer')).toBeInTheDocument();
    expect(screen.getByText('🦌')).toBeInTheDocument();
    // Date/time is formatted by formatDateTime
    expect(screen.getByText(/Mar/)).toBeInTheDocument();
  });

  it('renders weather tags and activity tags', () => {
    const sighting = createMockSighting({
      weatherCondition: 'Clear',
      temperature: 45,
      windDirection: 'NW',
      windSpeed: 10,
      moonPhase: 'Full Moon',
    });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    expect(screen.getByText('Feeding')).toBeInTheDocument();
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
    expect(screen.getByText('45°F')).toBeInTheDocument();
    expect(screen.getByText('NW 10mph')).toBeInTheDocument();
    expect(screen.getByText('Full Moon')).toBeInTheDocument();
  });

  it('shows AI confidence bar when aiConfidence is set', () => {
    const sighting = createMockSighting({ aiConfidence: 85 });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    expect(screen.getByText('AI Confidence')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('shows "Overridden" badge when wasOverridden', () => {
    const sighting = createMockSighting({ aiConfidence: 80, wasOverridden: true });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    expect(screen.getByText('Overridden')).toBeInTheDocument();
  });

  it('photo expands on click', async () => {
    const user = userEvent.setup();
    const sighting = createMockSighting({
      photos: [{ id: 'p1', localPath: '/photo.jpg', uploaded: false }],
    });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    // Click the photo container to toggle expanded
    await user.click(img.parentElement!);
    // The container should have max-h-96 class (expanded)
    expect(img.parentElement).toHaveClass('max-h-96');
  });

  it('edit button calls onEdit', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const sighting = createMockSighting();
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} onEdit={onEdit} />);

    await user.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(sighting);
  });

  it('delete button calls onDelete after confirm', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const sighting = createMockSighting({ id: 'abc' });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByText('Delete'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('abc');
  });

  it('delete button does not call onDelete when confirm is cancelled', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const sighting = createMockSighting();
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByText('Delete'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const sighting = createMockSighting();
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} onClose={onClose} />);

    // The close button is an SVG button
    const buttons = screen.getAllByRole('button');
    // Close button is the one that's not Edit or Delete
    const closeButton = buttons.find(
      b => b.textContent !== 'Edit' && b.textContent !== 'Delete'
    )!;
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles sighting with no photos gracefully', () => {
    const sighting = createMockSighting({ photos: [] });
    renderWithProviders(<SightingCard sighting={sighting} {...defaultProps} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Whitetail Deer')).toBeInTheDocument();
  });
});
