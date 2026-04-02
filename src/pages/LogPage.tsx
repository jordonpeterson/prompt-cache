import { useState, useMemo } from 'react';
import { useSightings } from '@/hooks/useSightings';
import SightingsList from '@/components/SightingsList';
import SightingCard from '@/components/SightingCard';
import SightingForm from '@/components/SightingForm';
import FilterBar, { type Filters } from '@/components/FilterBar';
import type { Sighting } from '@/types';

export default function LogPage() {
  const { sightings, update, remove } = useSightings();
  const [filters, setFilters] = useState<Filters>({ species: [], timePeriods: [] });
  const [selected, setSelected] = useState<Sighting | null>(null);
  const [editing, setEditing] = useState<Sighting | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return sightings.filter(s => {
      if (filters.species.length > 0 && !filters.species.includes(s.species)) return false;
      if (filters.timePeriods.length > 0 && !filters.timePeriods.includes(s.timePeriod)) return false;
      if (filters.dateFrom && s.sightedAt < filters.dateFrom) return false;
      if (filters.dateTo && s.sightedAt > filters.dateTo + 'T23:59:59.999Z') return false;
      if (filters.hasPhoto && s.photos.length === 0) return false;
      if (search) {
        const q = search.toLowerCase();
        return s.species.toLowerCase().includes(q) ||
               s.notes?.toLowerCase().includes(q) ||
               s.activity.toLowerCase().includes(q);
      }
      return true;
    });
  }, [sightings, filters, search]);

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Search */}
      <div className="px-3 pt-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sightings..."
          className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm placeholder:text-gray-500 border border-gray-700 focus:border-green-600 outline-none"
        />
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {/* Count */}
      <div className="px-3 py-1.5">
        <span className="text-xs text-gray-500">{filtered.length} sighting{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-20">
        <SightingsList sightings={filtered} onSelect={setSelected} />
      </div>

      {/* Detail card */}
      {selected && !editing && (
        <SightingCard
          sighting={selected}
          onClose={() => setSelected(null)}
          onEdit={(s) => { setEditing(s); setSelected(null); }}
          onDelete={(id) => { remove(id); setSelected(null); }}
          expanded
        />
      )}

      {/* Edit form */}
      {editing && (
        <SightingForm
          latitude={editing.latitude}
          longitude={editing.longitude}
          initialData={editing}
          onSave={(data) => {
            update(editing.id, data);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
          photoUrl={editing.photos[0]?.localPath ?? editing.photos[0]?.remoteUrl}
        />
      )}
    </div>
  );
}
