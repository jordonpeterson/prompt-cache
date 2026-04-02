import { useState, useEffect, useRef } from 'react';
import type { Sighting, Activity, SightingType, TimePeriod, SightingSource } from '@/types';
import { getTimePeriod } from '@/lib/time';
import { fetchWeather } from '@/lib/weather';
import { useNetwork } from '@/hooks/useNetwork';
import SpeciesPicker from './SpeciesPicker';

interface SightingFormProps {
  latitude: number;
  longitude: number;
  initialData?: Partial<Sighting>;
  onSave: (data: Omit<Sighting, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'clientUpdatedAt'>) => void;
  onCancel: () => void;
  photoUrl?: string;
}

const ACTIVITIES: Activity[] = ['Feeding', 'Bedded', 'Traveling', 'Rutting', 'Watering', 'Unknown'];
const SIGHTING_TYPES: SightingType[] = ['LiveAnimal', 'Tracks', 'Scrape', 'Rub', 'Scat', 'Wallow', 'Bed', 'Other'];
const TIME_PERIODS: TimePeriod[] = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'];

export default function SightingForm({ latitude, longitude, initialData, onSave, onCancel, photoUrl }: SightingFormProps) {
  const { online } = useNetwork();
  const now = new Date();

  const [species, setSpecies] = useState(initialData?.species ?? '');
  const [count, setCount] = useState(Math.max(1, initialData?.count ?? 1));
  const [activity, setActivity] = useState<Activity>(initialData?.activity ?? 'Unknown');
  const [sightingType, setSightingType] = useState<SightingType>(initialData?.sightingType ?? 'LiveAnimal');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(initialData?.timePeriod ?? getTimePeriod(now));
  const [dateTime, setDateTime] = useState(initialData?.sightedAt ?? now.toISOString().slice(0, 16));
  const [notes, setNotes] = useState(initialData?.notes ?? '');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weather, setWeather] = useState<{
    condition?: string; temperature?: number; windSpeed?: number;
    windDirection?: string; humidity?: number; barometricPressure?: number;
    moonPhase?: string; sunrise?: string; sunset?: string;
  }>({
    condition: initialData?.weatherCondition,
    temperature: initialData?.temperature,
    windSpeed: initialData?.windSpeed,
    windDirection: initialData?.windDirection,
    humidity: initialData?.humidity,
    moonPhase: initialData?.moonPhase,
  });

  // Auto-fetch weather with debouncing and cleanup
  const weatherTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!online) return;
    setWeatherLoading(true);
    let cancelled = false;

    clearTimeout(weatherTimerRef.current);
    weatherTimerRef.current = setTimeout(() => {
      fetchWeather(latitude, longitude, dateTime || now.toISOString())
        .then(w => { if (w && !cancelled) setWeather(w); })
        .finally(() => { if (!cancelled) setWeatherLoading(false); });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(weatherTimerRef.current);
    };
  }, [latitude, longitude, dateTime, online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-update time period when datetime changes
  useEffect(() => {
    if (dateTime) {
      setTimePeriod(getTimePeriod(new Date(dateTime)));
    }
  }, [dateTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!species) return;

    const sightedAt = dateTime ? new Date(dateTime).toISOString() : now.toISOString();

    onSave({
      latitude,
      longitude,
      altitude: initialData?.altitude,
      compassHeading: initialData?.compassHeading,
      sightedAt,
      timePeriod,
      species,
      count,
      activity,
      sightingType,
      weatherCondition: weather.condition,
      temperature: weather.temperature,
      windSpeed: weather.windSpeed,
      windDirection: weather.windDirection,
      humidity: weather.humidity,
      barometricPressure: weather.barometricPressure,
      moonPhase: weather.moonPhase,
      sunrise: weather.sunrise,
      sunset: weather.sunset,
      aiSpeciesGuess: initialData?.aiSpeciesGuess,
      aiConfidence: initialData?.aiConfidence,
      aiAlternatives: initialData?.aiAlternatives,
      wasOverridden: initialData?.wasOverridden ?? false,
      photos: initialData?.photos ?? [],
      notes: notes || undefined,
      source: (initialData?.source ?? 'Manual') as SightingSource,
      isPublic: false,
    });
  };

  return (
    <div className="absolute inset-0 z-50 bg-gray-900/95 overflow-y-auto">
      <form onSubmit={handleSubmit} className="max-w-lg mx-auto p-4 pb-24">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            {initialData?.id ? 'Edit Sighting' : 'New Sighting'}
          </h2>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-white p-2">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Photo preview */}
        {photoUrl && (
          <div className="mb-4 rounded-lg overflow-hidden">
            <img src={photoUrl} alt="Sighting photo" className="w-full max-h-48 object-cover" />
          </div>
        )}

        {/* Location */}
        <div className="mb-4 bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-400 mb-1">Location</p>
          <p className="text-sm text-gray-200 font-mono">
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </p>
        </div>

        {/* Species */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Species *</span>
          <SpeciesPicker value={species} onChange={setSpecies} />
        </label>

        {/* Count */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Count</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCount(Math.max(1, count - 1))}
              className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-xl font-bold"
            >-</button>
            <span className="text-xl text-white font-bold w-10 text-center">{count}</span>
            <button
              type="button"
              onClick={() => setCount(Math.min(99, count + 1))}
              className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-xl font-bold"
            >+</button>
          </div>
        </label>

        {/* Date/Time */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Date & Time</span>
          <input
            type="datetime-local"
            value={dateTime.slice(0, 16)}
            max={new Date().toISOString().slice(0, 16)}
            onChange={e => setDateTime(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5"
          />
        </label>

        {/* Time Period */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Time of Day</span>
          <div className="grid grid-cols-3 gap-1.5">
            {TIME_PERIODS.map(tp => (
              <button
                key={tp}
                type="button"
                onClick={() => setTimePeriod(tp)}
                className={`py-1.5 rounded text-sm font-medium transition-colors ${
                  timePeriod === tp
                    ? 'bg-green-700 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{tp}</button>
            ))}
          </div>
        </label>

        {/* Activity */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Activity</span>
          <div className="grid grid-cols-3 gap-1.5">
            {ACTIVITIES.map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setActivity(a)}
                className={`py-1.5 rounded text-sm font-medium transition-colors ${
                  activity === a
                    ? 'bg-green-700 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{a}</button>
            ))}
          </div>
        </label>

        {/* Sighting Type */}
        <label className="block mb-4">
          <span className="text-sm text-gray-400 mb-1 block">Sighting Type</span>
          <div className="grid grid-cols-4 gap-1.5">
            {SIGHTING_TYPES.map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setSightingType(st)}
                className={`py-1.5 rounded text-xs font-medium transition-colors ${
                  sightingType === st
                    ? 'bg-green-700 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >{st}</button>
            ))}
          </div>
        </label>

        {/* Weather (auto-filled) */}
        <div className="mb-4 bg-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Weather (auto-filled)</span>
            {weatherLoading && <span className="text-xs text-green-400 animate-pulse">Loading...</span>}
          </div>
          {weather.condition ? (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{weather.condition}</span>
              {weather.temperature != null && (
                <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{weather.temperature}°F</span>
              )}
              {weather.windDirection && weather.windSpeed != null && (
                <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">
                  {weather.windDirection} {weather.windSpeed}mph
                </span>
              )}
              {weather.humidity != null && (
                <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{weather.humidity}% humidity</span>
              )}
              {weather.moonPhase && (
                <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{weather.moonPhase}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              {online ? 'Fetching weather data...' : 'Weather unavailable offline'}
            </p>
          )}
        </div>

        {/* Notes */}
        <label className="block mb-6">
          <span className="text-sm text-gray-400 mb-1 block">Notes</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add any notes..."
            rows={3}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 placeholder:text-gray-500 resize-none"
          />
        </label>

        {/* Submit */}
        <button
          type="submit"
          disabled={!species}
          className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold rounded-xl text-lg transition-colors"
        >
          {initialData?.id ? 'Save Changes' : 'Confirm & Drop Pin'}
        </button>
      </form>
    </div>
  );
}
