import type { AIAnalysisResult } from '@/types';
import { getSpeciesInfo } from '@/lib/species';

interface AIAnalysisProps {
  result: AIAnalysisResult | null;
  loading: boolean;
  error?: string;
  onAccept: (species: string) => void;
  onOverride: () => void;
}

export default function AIAnalysis({ result, loading, error, onAccept, onOverride }: AIAnalysisProps) {
  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
          <div>
            <p className="text-white font-medium">Identifying animal...</p>
            <p className="text-xs text-gray-400">AI is analyzing your photo</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4">
        <p className="text-red-300 text-sm">{error}</p>
      </div>
    );
  }

  if (!result) return null;

  const info = getSpeciesInfo(result.species);
  const lowConfidence = result.confidence < 70;

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 uppercase tracking-wider">AI Identification</span>
        {lowConfidence && (
          <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
            Low confidence — verify
          </span>
        )}
      </div>

      {/* Primary result */}
      <div className="flex items-center gap-3 mb-3">
        <span
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
          style={{ background: info.color }}
        >
          {info.emoji}
        </span>
        <div className="flex-1">
          <p className="text-white font-semibold text-lg">{result.species}</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  result.confidence >= 90 ? 'bg-green-500' :
                  result.confidence >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${result.confidence}%` }}
              />
            </div>
            <span className="text-xs text-gray-300 font-mono w-8">{result.confidence}%</span>
          </div>
        </div>
      </div>

      {/* Alternatives */}
      {result.alternatives.length > 0 && (
        <div className="mb-3 space-y-1">
          {result.alternatives.map((alt) => {
            const altInfo = getSpeciesInfo(alt.species);
            return (
              <button
                key={`${alt.species}-${alt.confidence}`}
                onClick={() => onAccept(alt.species)}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-gray-700/50 rounded hover:bg-gray-600 transition-colors"
              >
                <span className="text-sm">{altInfo.emoji}</span>
                <span className="text-sm text-gray-300 flex-1 text-left">{alt.species}</span>
                <span className="text-xs text-gray-500 font-mono">{alt.confidence}%</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Additional info */}
      <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
        {result.sightingType && (
          <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{result.sightingType}</span>
        )}
        {result.count > 1 && (
          <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">Count: {result.count}</span>
        )}
        {result.sex && (
          <span className="px-2 py-0.5 bg-gray-700 text-gray-200 rounded">{result.sex}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onAccept(result.species)}
          className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Accept: {result.species}
        </button>
        <button
          onClick={onOverride}
          className="py-2 px-3 bg-gray-700 hover:bg-gray-600 text-yellow-300 rounded-lg text-sm font-medium transition-colors"
        >
          Wrong? Override
        </button>
      </div>
    </div>
  );
}
