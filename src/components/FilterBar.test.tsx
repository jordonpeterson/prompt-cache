import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import FilterBar, { type Filters } from './FilterBar';

const emptyFilters: Filters = {
  species: [],
  timePeriods: [],
};

describe('FilterBar', () => {
  it('renders collapsed by default', () => {
    renderWithProviders(<FilterBar filters={emptyFilters} onChange={vi.fn()} />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
    // Species section label should not be visible when collapsed
    expect(screen.queryByText('Species')).not.toBeInTheDocument();
  });

  it('expands on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FilterBar filters={emptyFilters} onChange={vi.fn()} />);

    await user.click(screen.getByText('Filters'));
    expect(screen.getByText('Species')).toBeInTheDocument();
    expect(screen.getByText('Time of Day')).toBeInTheDocument();
  });

  it('shows active filter count', () => {
    const filters: Filters = {
      species: ['Whitetail Deer', 'Elk'],
      timePeriods: ['Morning'],
    };
    renderWithProviders(<FilterBar filters={filters} onChange={vi.fn()} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('toggles species filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<FilterBar filters={emptyFilters} onChange={onChange} />);

    await user.click(screen.getByText('Filters'));
    await user.click(screen.getByText(/Whitetail Deer/));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ species: ['Whitetail Deer'] })
    );
  });

  it('untoggle species filter when already selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters: Filters = { species: ['Whitetail Deer'], timePeriods: [] };
    renderWithProviders(<FilterBar filters={filters} onChange={onChange} />);

    await user.click(screen.getByText('Filters'));
    await user.click(screen.getByText(/Whitetail Deer/));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ species: [] })
    );
  });

  it('toggles time period filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<FilterBar filters={emptyFilters} onChange={onChange} />);

    await user.click(screen.getByText('Filters'));
    await user.click(screen.getByText('Dawn'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timePeriods: ['Dawn'] })
    );
  });

  it('clears all filters including date range and hasPhoto', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const filters: Filters = {
      species: ['Elk'],
      timePeriods: ['Morning'],
      dateFrom: '2026-03-01',
      dateTo: '2026-04-01',
      hasPhoto: true,
    };
    renderWithProviders(<FilterBar filters={filters} onChange={onChange} />);

    await user.click(screen.getByText('Clear all'));

    expect(onChange).toHaveBeenCalledWith({
      species: [],
      timePeriods: [],
      dateFrom: undefined,
      dateTo: undefined,
      hasPhoto: undefined,
    });
  });

  it('date range inputs work', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<FilterBar filters={emptyFilters} onChange={onChange} />);

    await user.click(screen.getByText('Filters'));

    const fromInput = screen.getByLabelText('From');
    await user.type(fromInput, '2026-03-01');

    expect(onChange).toHaveBeenCalled();
  });
});
