import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import type { Sighting, TimePeriod } from '@/types';
import { getSpeciesColor } from '@/lib/species';

interface AnalyticsProps {
  sightings: Sighting[];
}

const TIME_PERIODS: TimePeriod[] = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'];

export default function Analytics({ sightings }: AnalyticsProps) {
  const timeData = useMemo(() => {
    const counts: Record<string, number> = {};
    TIME_PERIODS.forEach(tp => { counts[tp] = 0; });
    sightings.forEach(s => { counts[s.timePeriod] = (counts[s.timePeriod] || 0) + 1; });
    return TIME_PERIODS.map(tp => ({ name: tp, count: counts[tp] }));
  }, [sightings]);

  const speciesData = useMemo(() => {
    const counts: Record<string, number> = {};
    sightings.forEach(s => { counts[s.species] = (counts[s.species] || 0) + 1; });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count, color: getSpeciesColor(name) }))
      .sort((a, b) => b.count - a.count);
  }, [sightings]);

  const weatherData = useMemo(() => {
    const counts: Record<string, number> = {};
    sightings.forEach(s => {
      if (s.weatherCondition) {
        counts[s.weatherCondition] = (counts[s.weatherCondition] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [sightings]);

  const stats = useMemo(() => {
    const withConfidence = sightings.filter(s => s.aiConfidence != null);
    return {
      total: sightings.length,
      species: new Set(sightings.map(s => s.species)).size,
      withPhotos: sightings.filter(s => s.photos.length > 0).length,
      avgConfidence: withConfidence.length > 0
        ? Math.round(withConfidence.reduce((sum, s) => sum + s.aiConfidence!, 0) / withConfidence.length)
        : null,
    };
  }, [sightings]);

  if (sightings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
        <svg className="w-16 h-16 mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
        <p className="text-lg font-medium mb-1">No data yet</p>
        <p className="text-sm text-center">Start logging sightings to see patterns and analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Sightings" value={stats.total} />
        <StatCard label="Species Seen" value={stats.species} />
        <StatCard label="Photo Verified" value={stats.withPhotos} />
        {stats.avgConfidence != null && (
          <StatCard label="Avg AI Confidence" value={`${stats.avgConfidence}%`} />
        )}
      </div>

      {/* Activity by Time of Day */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-3">Activity by Time of Day</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={timeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
            <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }}
              labelStyle={{ color: '#fff' }}
            />
            <Bar dataKey="count" fill="#4a7c28" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Species Breakdown */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h3 className="text-white font-semibold mb-3">Species Breakdown</h3>
        {speciesData.length <= 8 ? (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={speciesData}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, count }) => `${name} (${count})`}
                labelLine={{ stroke: '#6B7280' }}
              >
                {speciesData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="space-y-1.5">
            {speciesData.map(s => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-sm text-gray-300 flex-1">{s.name}</span>
                <span className="text-sm text-gray-400 font-mono">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weather Conditions */}
      {weatherData.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3">Weather Conditions</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weatherData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9CA3AF', fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} width={80} />
              <Tooltip
                contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }}
              />
              <Bar dataKey="count" fill="#2d5016" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
