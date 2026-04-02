import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNetwork } from './useNetwork';

describe('useNetwork', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  it('returns online=true when navigator.onLine is true', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const { result } = renderHook(() => useNetwork());
    expect(result.current.online).toBe(true);
  });

  it('returns online=false when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() => useNetwork());
    expect(result.current.online).toBe(false);
  });

  it('updates to false on offline event', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const { result } = renderHook(() => useNetwork());

    expect(result.current.online).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.online).toBe(false);
  });

  it('updates to true on online event', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() => useNetwork());

    expect(result.current.online).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.online).toBe(true);
  });

  it('handles multiple online/offline transitions', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const { result } = renderHook(() => useNetwork());

    expect(result.current.online).toBe(true);

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current.online).toBe(true);

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);
  });

  it('cleans up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useNetwork());

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    // Capture the listener references
    const onlineHandler = addSpy.mock.calls.find(c => c[0] === 'online')![1];
    const offlineHandler = addSpy.mock.calls.find(c => c[0] === 'offline')![1];

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('online', onlineHandler);
    expect(removeSpy).toHaveBeenCalledWith('offline', offlineHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not update state after unmount', () => {
    const { result, unmount } = renderHook(() => useNetwork());
    expect(result.current.online).toBe(true);

    unmount();

    // Should not throw or cause issues
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
  });
});
