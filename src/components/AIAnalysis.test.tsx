import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import AIAnalysis from './AIAnalysis';
import type { AIAnalysisResult } from '@/types';

const defaultProps = {
  result: null as AIAnalysisResult | null,
  loading: false,
  onAccept: vi.fn(),
  onOverride: vi.fn(),
};

const mockResult: AIAnalysisResult = {
  species: 'Whitetail Deer',
  confidence: 92,
  alternatives: [
    { species: 'Mule Deer', confidence: 6 },
  ],
  sightingType: 'LiveAnimal',
  count: 1,
};

describe('AIAnalysis', () => {
  it('shows loading spinner when loading=true', () => {
    renderWithProviders(
      <AIAnalysis {...defaultProps} loading={true} />
    );
    expect(screen.getByText('Identifying animal...')).toBeInTheDocument();
    expect(screen.getByText('AI is analyzing your photo')).toBeInTheDocument();
  });

  it('shows error message when error is set', () => {
    renderWithProviders(
      <AIAnalysis {...defaultProps} error="Failed to analyze photo" />
    );
    expect(screen.getByText('Failed to analyze photo')).toBeInTheDocument();
  });

  it('shows primary species with confidence bar', () => {
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} />
    );
    expect(screen.getByText('Whitetail Deer')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('shows alternative species', () => {
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} />
    );
    expect(screen.getByText('Mule Deer')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
  });

  it('shows low confidence warning when < 70', () => {
    const lowResult: AIAnalysisResult = {
      ...mockResult,
      confidence: 45,
    };
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={lowResult} />
    );
    expect(screen.getByText(/Low confidence/)).toBeInTheDocument();
  });

  it('does not show low confidence warning when >= 70', () => {
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} />
    );
    expect(screen.queryByText(/Low confidence/)).not.toBeInTheDocument();
  });

  it('accept button calls onAccept with species name', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} onAccept={onAccept} />
    );

    await user.click(screen.getByText(/Accept: Whitetail Deer/));
    expect(onAccept).toHaveBeenCalledWith('Whitetail Deer');
  });

  it('clicking alternative calls onAccept with that species', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} onAccept={onAccept} />
    );

    await user.click(screen.getByText('Mule Deer'));
    expect(onAccept).toHaveBeenCalledWith('Mule Deer');
  });

  it('override button calls onOverride', async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    renderWithProviders(
      <AIAnalysis {...defaultProps} result={mockResult} onOverride={onOverride} />
    );

    await user.click(screen.getByText(/Wrong\? Override/));
    expect(onOverride).toHaveBeenCalled();
  });

  it('returns null when no result and not loading', () => {
    const { container } = renderWithProviders(
      <AIAnalysis {...defaultProps} />
    );
    expect(container.firstChild).toBeNull();
  });
});
