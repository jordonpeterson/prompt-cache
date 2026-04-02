import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import SpeciesPicker from './SpeciesPicker';

describe('SpeciesPicker', () => {
  it('renders with selected species displayed', () => {
    renderWithProviders(<SpeciesPicker value="Whitetail Deer" onChange={vi.fn()} />);
    expect(screen.getByText('Whitetail Deer')).toBeInTheDocument();
    expect(screen.getByText('🦌')).toBeInTheDocument();
  });

  it('renders placeholder when no species selected', () => {
    renderWithProviders(<SpeciesPicker value="" onChange={vi.fn()} />);
    expect(screen.getByText('Select species...')).toBeInTheDocument();
  });

  it('opens search on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SpeciesPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /select species/i }));
    expect(screen.getByPlaceholderText('Search species...')).toBeInTheDocument();
  });

  it('filters species list on search input', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SpeciesPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /select species/i }));
    await user.type(screen.getByPlaceholderText('Search species...'), 'elk');

    expect(screen.getByText('Elk')).toBeInTheDocument();
    expect(screen.queryByText('Whitetail Deer')).not.toBeInTheDocument();
  });

  it('calls onChange when species selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<SpeciesPicker value="" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /select species/i }));
    await user.click(screen.getByText('Elk'));

    expect(onChange).toHaveBeenCalledWith('Elk');
  });

  it('closes after selection', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SpeciesPicker value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /select species/i }));
    await user.click(screen.getByText('Elk'));

    // Should be back to closed state with a button
    expect(screen.queryByPlaceholderText('Search species...')).not.toBeInTheDocument();
  });
});
