import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLocation } from './useLocation';

describe('useLocation', () => {
  // The setup.ts already defines navigator.geolocation with vi.fn() mocks.
  // We access them directly.
  const mockWatchPosition = navigator.geolocation.watchPosition as ReturnType<typeof vi.fn>;
  const mockClearWatch = navigator.geolocation.clearWatch as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWatchPosition.mockReset();
    mockClearWatch.mockReset();
  });

  it('initial state has loading=true, location=null, error=null', () => {
    mockWatchPosition.mockReturnValue(1);
    const { result } = renderHook(() => useLocation());

    expect(result.current.loading).toBe(true);
    expect(result.current.location).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets location and loading=false on successful position', () => {
    mockWatchPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 45.5,
          longitude: -93.2,
          altitude: 300,
          heading: 180,
        },
      });
      return 1;
    });

    const { result } = renderHook(() => useLocation());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.location).toEqual({
      latitude: 45.5,
      longitude: -93.2,
      altitude: 300,
      heading: 180,
    });
  });

  it('converts null altitude and heading to undefined', () => {
    mockWatchPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 45.5,
          longitude: -93.2,
          altitude: null,
          heading: null,
        },
      });
      return 1;
    });

    const { result } = renderHook(() => useLocation());

    expect(result.current.location).toEqual({
      latitude: 45.5,
      longitude: -93.2,
      altitude: undefined,
      heading: undefined,
    });
  });

  it('sets error and loading=false on geolocation error', () => {
    mockWatchPosition.mockImplementation((_success, error) => {
      error({ message: 'User denied Geolocation' });
      return 1;
    });

    const { result } = renderHook(() => useLocation());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('User denied Geolocation');
    expect(result.current.location).toBeNull();
  });

  it('updates location when watchPosition fires again', () => {
    let successCallback: (pos: unknown) => void;
    mockWatchPosition.mockImplementation((success) => {
      successCallback = success;
      return 1;
    });

    const { result } = renderHook(() => useLocation());

    act(() => {
      successCallback({
        coords: { latitude: 45.0, longitude: -93.0, altitude: null, heading: null },
      });
    });

    expect(result.current.location!.latitude).toBe(45.0);

    act(() => {
      successCallback({
        coords: { latitude: 46.0, longitude: -94.0, altitude: 500, heading: 90 },
      });
    });

    expect(result.current.location).toEqual({
      latitude: 46.0,
      longitude: -94.0,
      altitude: 500,
      heading: 90,
    });
  });

  it('clears error when a successful position comes after an error', () => {
    let successCallback: (pos: unknown) => void;
    let errorCallback: (err: unknown) => void;
    mockWatchPosition.mockImplementation((success, error) => {
      successCallback = success;
      errorCallback = error;
      return 1;
    });

    const { result } = renderHook(() => useLocation());

    act(() => {
      errorCallback({ message: 'Timeout' });
    });

    expect(result.current.error).toBe('Timeout');

    act(() => {
      successCallback({
        coords: { latitude: 45.0, longitude: -93.0, altitude: null, heading: null },
      });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.location).not.toBeNull();
  });

  it('calls clearWatch on unmount', () => {
    const watchId = 42;
    mockWatchPosition.mockReturnValue(watchId);

    const { unmount } = renderHook(() => useLocation());

    expect(mockClearWatch).not.toHaveBeenCalled();
    unmount();
    expect(mockClearWatch).toHaveBeenCalledWith(watchId);
  });

  it('passes high accuracy options to watchPosition', () => {
    mockWatchPosition.mockReturnValue(1);
    renderHook(() => useLocation());

    expect(mockWatchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    );
  });
});
