import { useState } from 'react';
import { SPECIES_LIST } from '@/lib/species';
import type { TimePeriod } from '@/types';

export interface Filters {
  species: string[];
  timePeriods: TimePeriod[];
  dateFrom?: string;
  dateTo?: string;
  hasPhoto?: boolean;
}

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

const TIME_PERIODS: TimePeriod[] = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'];

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = filters.species.length + filters.timePeriods.length +
    (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0) + (filters.hasPhoto != null ? 1 : 0);

  const toggleSpecies = (name: string) => {
    const next = filters.species.includes(name)
      ? filters.species.filter(s => s !== name)
      : [...filters.species, name];
    onChange({ ...filters, species: next });
  };

  const toggleTimePeriod = (tp: TimePeriod) => {
    const next = filters.timePeriods.includes(tp)
      ? filters.timePeriods.filter(t => t !== tp)
      : [...filters.timePeriods, tp];
    onChange({ ...filters, timePeriods: next });
  };

  const clearAll = () => {
    onChange({ species: [], timePeriods: [] });
  };

  return (
    <div className="bg-gray-800 border-b border-gray-700">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">{activeCount}</span>
          )}
        </button>
        {activeCount > 0 && (
          <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-300 ml-auto">
            Clear all
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Species filter */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Species</p>
            <div className="flex flex-wrap gap-1">
              {SPECIES_LIST.filter(s => s.name !== 'Unknown' && s.name !== 'Other').map(s => (
                <button
                  key={s.name}
                  onClick={() => toggleSpecies(s.name)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    filters.species.includes(s.name)
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {s.emoji} {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Time of day */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Time of Day</p>
            <div className="flex flex-wrap gap-1">
              {TIME_PERIODS.map(tp => (
                <button
                  key={tp}
                  onClick={() => toggleTimePeriod(tp)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    filters.timePeriods.includes(tp)
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-xs text-gray-400">From</span>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={e => onChange({ ...filters, dateFrom: e.target.value || undefined })}
                className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="flex-1">
              <span className="text-xs text-gray-400">To</span>
              <input
                type="date"
                value={filters.dateTo ?? ''}
                onChange={e => onChange({ ...filters, dateTo: e.target.value || undefined })}
                className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm"
              />
            </label>
          </div>

          {/* Photo filter */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.hasPhoto === true}
              onChange={e => onChange({ ...filters, hasPhoto: e.target.checked ? true : undefined })}
              className="rounded bg-gray-700 border-gray-600 text-green-600"
            />
            <span className="text-xs text-gray-300">Photo-verified only</span>
          </label>
        </div>
      )}
    </div>
  );
}
