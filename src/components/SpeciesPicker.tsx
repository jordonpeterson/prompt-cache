import { useState, useMemo } from 'react';
import { SPECIES_LIST } from '@/lib/species';

interface SpeciesPickerProps {
  value: string;
  onChange: (species: string) => void;
}

export default function SpeciesPicker({ value, onChange }: SpeciesPickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() =>
    SPECIES_LIST.filter(s => s.name.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  const selected = SPECIES_LIST.find(s => s.name === value);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2.5 text-left text-white hover:bg-gray-600 transition-colors"
      >
        {selected && <span className="text-lg">{selected.emoji}</span>}
        <span className={selected ? 'text-white' : 'text-gray-400'}>
          {selected?.name ?? 'Select species...'}
        </span>
      </button>
    );
  }

  return (
    <div className="bg-gray-700 rounded-lg overflow-hidden">
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search species..."
        className="w-full bg-gray-600 text-white px-3 py-2.5 outline-none placeholder:text-gray-400"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto">
        {filtered.map(s => (
          <button
            key={s.name}
            type="button"
            onClick={() => { onChange(s.name); setOpen(false); setSearch(''); }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-600 transition-colors ${
              s.name === value ? 'bg-green-900/30 text-green-400' : 'text-gray-200'
            }`}
          >
            <span className="text-lg">{s.emoji}</span>
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
