import type { WeatherData } from '@/types';

const WMO_CODES: Record<number, string> = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  77: 'Snow Grains', 80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  85: 'Light Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ Hail', 99: 'Thunderstorm w/ Heavy Hail',
};

const WIND_DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function degreesToDirection(deg: number): string {
  if (!Number.isFinite(deg)) return 'N';
  return WIND_DIRECTIONS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

const MOON_PHASES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
];

function dayOfYearMoonPhase(date: Date): string {
  // Simple approximation based on synodic month (~29.53 days)
  const known = new Date(2000, 0, 6); // Known new moon
  const diff = (date.getTime() - known.getTime()) / (1000 * 60 * 60 * 24);
  const phase = ((diff % 29.53) + 29.53) % 29.53;
  const idx = Math.round(phase / 3.69) % 8;
  return MOON_PHASES[idx];
}

export async function fetchWeather(lat: number, lng: number, dateISO: string): Promise<WeatherData | null> {
  try {
    const date = new Date(dateISO);
    const dateStr = date.toISOString().split('T')[0];
    const hour = date.getHours();

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,relative_humidity_2m,surface_pressure,weather_code,wind_speed_10m,wind_direction_10m&daily=sunrise,sunset&start_date=${dateStr}&end_date=${dateStr}&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const hourly = data.hourly;
    const daily = data.daily;
    const idx = Math.min(hour, (hourly.temperature_2m?.length ?? 1) - 1);

    return {
      condition: WMO_CODES[hourly.weather_code?.[idx]] ?? 'Unknown',
      temperature: Math.round(hourly.temperature_2m?.[idx] ?? 0),
      windSpeed: Math.round(hourly.wind_speed_10m?.[idx] ?? 0),
      windDirection: degreesToDirection(hourly.wind_direction_10m?.[idx] ?? 0),
      humidity: Math.round(hourly.relative_humidity_2m?.[idx] ?? 0),
      barometricPressure: Math.round((hourly.surface_pressure?.[idx] ?? 0) * 0.02953 * 100) / 100, // hPa → inHg
      moonPhase: dayOfYearMoonPhase(date),
      sunrise: daily.sunrise?.[0]?.split('T')[1] ?? '',
      sunset: daily.sunset?.[0]?.split('T')[1] ?? '',
    };
  } catch {
    return null;
  }
}
