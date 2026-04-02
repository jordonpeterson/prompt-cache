import type { Sighting } from '@/types';
import { getSpeciesInfo } from '@/lib/species';
import { formatDate, formatTime } from '@/lib/time';

interface SightingsListProps {
  sightings: Sighting[];
  onSelect: (sighting: Sighting) => void;
}

export default function SightingsList({ sightings, onSelect }: SightingsListProps) {
  if (sightings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
        <svg className="w-16 h-16 mb-4 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
        </svg>
        <p className="text-lg font-medium mb-1">No sightings yet</p>
        <p className="text-sm text-center">Tap the camera button or tap the map to log your first sighting.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      {sightings.map(sighting => {
        const info = getSpeciesInfo(sighting.species);
        return (
          <button
            key={sighting.id}
            onClick={() => onSelect(sighting)}
            className="w-full bg-gray-800 rounded-xl p-3 flex items-start gap-3 text-left hover:bg-gray-700 transition-colors active:scale-[0.98]"
          >
            {/* Species icon */}
            <span
              className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0"
              style={{ background: info.color }}
            >
              {info.emoji}
            </span>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-white font-semibold">{sighting.species}</span>
                {sighting.count > 1 && (
                  <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">
                    x{sighting.count}
                  </span>
                )}
                {sighting.photos.length > 0 && (
                  <span className="text-xs text-green-400">📷</span>
                )}
                {sighting.aiConfidence != null && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    sighting.aiConfidence >= 90 ? 'bg-green-900/50 text-green-400' :
                    sighting.aiConfidence >= 70 ? 'bg-yellow-900/50 text-yellow-400' :
                    'bg-red-900/50 text-red-400'
                  }`}>
                    AI {sighting.aiConfidence}%
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                <span>{formatDate(sighting.sightedAt)}</span>
                <span>·</span>
                <span>{formatTime(sighting.sightedAt)}</span>
                <span>·</span>
                <span>{sighting.timePeriod}</span>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded text-[10px]">{sighting.activity}</span>
                {sighting.weatherCondition && (
                  <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded text-[10px]">{sighting.weatherCondition}</span>
                )}
                {sighting.temperature != null && (
                  <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded text-[10px]">{sighting.temperature}°F</span>
                )}
                {sighting.windDirection && sighting.windSpeed != null && (
                  <span className="px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded text-[10px]">
                    {sighting.windDirection} {sighting.windSpeed}mph
                  </span>
                )}
              </div>

              {/* Notes preview */}
              {sighting.notes && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{sighting.notes}</p>
              )}
            </div>

            {/* Sync indicator */}
            <span className={`w-2 h-2 rounded-full shrink-0 mt-2 ${
              sighting.syncStatus === 'synced' ? 'bg-green-500' :
              sighting.syncStatus === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
          </button>
        );
      })}
    </div>
  );
}
