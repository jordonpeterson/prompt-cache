import type { Sighting } from '@/types';
import { getSpeciesInfo } from '@/lib/species';
import { formatDateTime } from '@/lib/time';
import { useState } from 'react';

interface SightingCardProps {
  sighting: Sighting;
  onClose: () => void;
  onEdit: (sighting: Sighting) => void;
  onDelete: (id: string) => void;
  expanded?: boolean;
}

export default function SightingCard({ sighting, onClose, onEdit, onDelete, expanded: initialExpanded }: SightingCardProps) {
  const [expanded, setExpanded] = useState(initialExpanded ?? false);
  const species = getSpeciesInfo(sighting.species);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-40 animate-slide-up">
      <div className="bg-gray-800 rounded-t-2xl border-t border-gray-600 shadow-2xl max-h-[80vh] overflow-y-auto">
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
              style={{ background: species.color }}
            >
              {species.emoji}
            </span>
            <div>
              <h3 className="text-white font-semibold text-lg">{sighting.species}</h3>
              <p className="text-gray-400 text-sm">{formatDateTime(sighting.sightedAt)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Photo thumbnail / expanded */}
        {sighting.photos.length > 0 && (sighting.photos[0].localPath || sighting.photos[0].remoteUrl) && (
          <div
            className={`mx-4 mb-3 rounded-lg overflow-hidden cursor-pointer transition-all ${
              expanded ? 'max-h-96' : 'max-h-32'
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            <img
              src={sighting.photos[0].localPath || sighting.photos[0].remoteUrl}
              alt={sighting.species}
              className="w-full object-cover"
            />
          </div>
        )}

        {/* AI confidence */}
        {sighting.aiConfidence != null && (
          <div className="mx-4 mb-3 flex items-center gap-2">
            <span className="text-xs text-gray-400">AI Confidence</span>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  sighting.aiConfidence >= 90 ? 'bg-green-500' :
                  sighting.aiConfidence >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${sighting.aiConfidence}%` }}
              />
            </div>
            <span className="text-xs text-gray-300 font-mono">{sighting.aiConfidence}%</span>
            {sighting.wasOverridden && (
              <span className="text-xs text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">Overridden</span>
            )}
          </div>
        )}

        {/* Tags */}
        <div className="mx-4 mb-3 flex flex-wrap gap-1.5">
          <Tag label={sighting.timePeriod} />
          <Tag label={`${sighting.count}x`} />
          <Tag label={sighting.activity} />
          <Tag label={sighting.sightingType} />
          {sighting.weatherCondition && <Tag label={sighting.weatherCondition} />}
          {sighting.temperature != null && <Tag label={`${sighting.temperature}°F`} />}
          {sighting.windDirection && sighting.windSpeed != null && (
            <Tag label={`${sighting.windDirection} ${sighting.windSpeed}mph`} />
          )}
          {sighting.moonPhase && <Tag label={sighting.moonPhase} />}
        </div>

        {/* Notes */}
        {sighting.notes && (
          <div className="mx-4 mb-3 text-sm text-gray-300 bg-gray-700/50 rounded-lg p-3">
            {sighting.notes}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mx-4 mb-4">
          <button
            onClick={() => onEdit(sighting)}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this sighting?')) onDelete(sighting.id);
            }}
            className="py-2 px-4 bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded-lg text-sm font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-xs">
      {label}
    </span>
  );
}
