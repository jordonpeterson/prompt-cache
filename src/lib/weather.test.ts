import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWeather } from './weather';

const mockHourlyData = (hour: number) => ({
  hourly: {
    weather_code: Array(24).fill(0).map((_, i) => i === hour ? 3 : 0),
    temperature_2m: Array(24).fill(60).map((_, i) => i === hour ? 72 : 60),
    wind_speed_10m: Array(24).fill(5).map((_, i) => i === hour ? 10 : 5),
    wind_direction_10m: Array(24).fill(0).map((_, i) => i === hour ? 180 : 0),
    relative_humidity_2m: Array(24).fill(50).map((_, i) => i === hour ? 65 : 50),
    surface_pressure: Array(24).fill(1013).map((_, i) => i === hour ? 1020 : 1013),
  },
  daily: {
    sunrise: ['2026-04-02T06:30'],
    sunset: ['2026-04-02T19:45'],
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWeather', () => {
  it('returns parsed weather data for valid response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHourlyData(10)),
    } as Response);

    const result = await fetchWeather(45.0, -93.0, '2026-04-02T10:00:00Z');

    expect(result).not.toBeNull();
    expect(result!.condition).toBe('Overcast');
    expect(result!.temperature).toBe(72);
    expect(result!.windSpeed).toBe(10);
    expect(result!.windDirection).toBe('S'); // 180 degrees = South
    expect(result!.humidity).toBe(65);
    expect(result!.sunrise).toBe('06:30');
    expect(result!.sunset).toBe('19:45');
    expect(result!.moonPhase).toBeTruthy();
  });

  it('returns null on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await fetchWeather(45.0, -93.0, '2026-04-02T10:00:00Z');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await fetchWeather(45.0, -93.0, '2026-04-02T10:00:00Z');
    expect(result).toBeNull();
  });

  it('handles missing hourly array entries gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hourly: {
          weather_code: [0],
          temperature_2m: [55],
          wind_speed_10m: [3],
          wind_direction_10m: [270],
          relative_humidity_2m: [40],
          surface_pressure: [1010],
        },
        daily: { sunrise: [], sunset: [] },
      }),
    } as Response);

    // Request hour 14 but only 1 data point exists - should clamp to index 0
    const result = await fetchWeather(45.0, -93.0, '2026-04-02T14:00:00Z');

    expect(result).not.toBeNull();
    expect(result!.temperature).toBe(55);
    expect(result!.windDirection).toBe('W'); // 270 degrees = West
    expect(result!.sunrise).toBe('');
    expect(result!.sunset).toBe('');
  });

  it('handles wind direction edge cases via fetch', async () => {
    // Test negative wind direction
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        hourly: {
          weather_code: [0],
          temperature_2m: [60],
          wind_speed_10m: [5],
          wind_direction_10m: [-90], // Negative value
          relative_humidity_2m: [50],
          surface_pressure: [1013],
        },
        daily: { sunrise: ['2026-04-02T06:00'], sunset: ['2026-04-02T19:00'] },
      }),
    } as Response);

    const result = await fetchWeather(45.0, -93.0, '2026-04-02T00:00:00Z');
    expect(result).not.toBeNull();
    expect(result!.windDirection).toBe('W'); // -90 degrees = 270 = West
  });

  it('constructs correct API URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHourlyData(0)),
    } as Response);

    await fetchWeather(45.5, -93.2, '2026-04-02T08:00:00Z');

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('latitude=45.5');
    expect(url).toContain('longitude=-93.2');
    expect(url).toContain('start_date=2026-04-02');
    expect(url).toContain('temperature_unit=fahrenheit');
    expect(url).toContain('wind_speed_unit=mph');
  });
});
