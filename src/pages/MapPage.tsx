import { useState, useCallback, useMemo } from 'react';
import MapView from '@/components/MapView';
import SightingCard from '@/components/SightingCard';
import SightingForm from '@/components/SightingForm';
import PhotoCapture from '@/components/PhotoCapture';
import AIAnalysis from '@/components/AIAnalysis';
import { useSightings } from '@/hooks/useSightings';
import { useLocation } from '@/hooks/useLocation';
import { useNetwork } from '@/hooks/useNetwork';
import { analyzePhoto, compressImage } from '@/lib/ai';
import { getTimePeriod } from '@/lib/time';
import type { Sighting, AIAnalysisResult } from '@/types';
import type { ExifData } from '@/lib/exif';

type Mode = 'map' | 'card' | 'form' | 'photo' | 'photo-confirm';

export default function MapPage() {
  const { sightings, add, update, remove } = useSightings();
  const { location } = useLocation();
  const { online } = useNetwork();

  const [mode, setMode] = useState<Mode>('map');
  const [selectedSighting, setSelectedSighting] = useState<Sighting | null>(null);
  const [formLat, setFormLat] = useState(0);
  const [formLng, setFormLng] = useState(0);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoExif, setPhotoExif] = useState<ExifData | null>(null);
  const [_photoFile, setPhotoFile] = useState<File | null>(null);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | undefined>();
  const [editingSighting, setEditingSighting] = useState<Partial<Sighting> | undefined>();

  const handlePinClick = useCallback((sighting: Sighting) => {
    setSelectedSighting(sighting);
    setMode('card');
  }, []);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setFormLat(lat);
    setFormLng(lng);
    setEditingSighting(undefined);
    setPhotoUrl(null);
    setMode('form');
  }, []);

  const handlePhotoTaken = useCallback(async (file: File, dataUrl: string, exif: ExifData) => {
    setPhotoFile(file);
    setPhotoUrl(dataUrl);
    setPhotoExif(exif);

    // Use EXIF location or current GPS
    const lat = exif.latitude ?? location?.latitude ?? 0;
    const lng = exif.longitude ?? location?.longitude ?? 0;
    setFormLat(lat);
    setFormLng(lng);

    // Start AI analysis if online
    setAiResult(null);
    setAiError(undefined);
    if (online) {
      setAiLoading(true);
      try {
        const compressed = await compressImage(dataUrl);
        const base64 = compressed.split(',')[1];
        const result = await analyzePhoto(base64);
        setAiResult(result);
      } catch (err) {
        setAiError(err instanceof Error ? err.message : 'AI analysis failed');
      } finally {
        setAiLoading(false);
      }
    }

    setEditingSighting({
      latitude: lat,
      longitude: lng,
      altitude: exif.altitude,
      compassHeading: exif.compassHeading,
      sightedAt: exif.dateTime ?? new Date().toISOString(),
      timePeriod: getTimePeriod(exif.dateTime ? new Date(exif.dateTime) : new Date()),
      source: 'Photo',
      photos: [{
        id: crypto.randomUUID(),
        localPath: dataUrl,
        uploaded: false,
      }],
    });

    setMode('photo-confirm');
  }, [location, online]);

  const handleAIAccept = useCallback((species: string) => {
    setEditingSighting(prev => ({
      ...prev,
      species,
      aiSpeciesGuess: aiResult?.species,
      aiConfidence: aiResult?.confidence,
      aiAlternatives: aiResult?.alternatives,
      wasOverridden: species !== aiResult?.species,
      sightingType: aiResult?.sightingType ?? prev?.sightingType,
      count: aiResult?.count ?? prev?.count,
    }));
  }, [aiResult]);

  const handleSave = useCallback((data: Omit<Sighting, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'clientUpdatedAt'>) => {
    if (editingSighting?.id) {
      update(editingSighting.id, data);
    } else {
      add(data);
    }
    setMode('map');
    setSelectedSighting(null);
    setPhotoUrl(null);
    setPhotoFile(null);
    setPhotoExif(null);
    setAiResult(null);
    setEditingSighting(undefined);
  }, [editingSighting, add, update]);

  const handleEdit = useCallback((sighting: Sighting) => {
    setEditingSighting(sighting);
    setFormLat(sighting.latitude);
    setFormLng(sighting.longitude);
    setPhotoUrl(sighting.photos[0]?.localPath ?? null);
    setMode('form');
  }, []);

  const handleDelete = useCallback((id: string) => {
    remove(id);
    setMode('map');
    setSelectedSighting(null);
  }, [remove]);

  // Camera tab handler (triggered from Layout nav)
  const handleCameraTab = useMemo(() => {
    return () => setMode('photo');
  }, []);

  // Expose camera handler on window for the Layout camera button
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__scoutlog_open_camera = handleCameraTab;
  }

  return (
    <>
      <MapView
        sightings={sightings}
        onPinClick={handlePinClick}
        onMapClick={handleMapClick}
        selectedId={selectedSighting?.id}
      />

      {mode === 'card' && selectedSighting && (
        <SightingCard
          sighting={selectedSighting}
          onClose={() => { setMode('map'); setSelectedSighting(null); }}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {mode === 'form' && (
        <SightingForm
          latitude={formLat}
          longitude={formLng}
          initialData={editingSighting}
          onSave={handleSave}
          onCancel={() => setMode('map')}
          photoUrl={photoUrl ?? undefined}
        />
      )}

      {mode === 'photo' && (
        <PhotoCapture
          onPhotoTaken={handlePhotoTaken}
          onCancel={() => setMode('map')}
        />
      )}

      {mode === 'photo-confirm' && (
        <div className="absolute inset-0 z-50 bg-gray-900 overflow-y-auto">
          <div className="max-w-lg mx-auto p-4 pb-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Review Photo</h2>
              <button onClick={() => setMode('map')} className="text-gray-400 hover:text-white p-2">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {photoUrl && (
              <div className="mb-4 rounded-lg overflow-hidden">
                <img src={photoUrl} alt="Captured" className="w-full max-h-64 object-cover" />
              </div>
            )}

            {/* EXIF info */}
            {photoExif && (photoExif.latitude || photoExif.dateTime) && (
              <div className="bg-gray-800 rounded-lg p-3 mb-4 text-xs text-gray-400 space-y-1">
                {photoExif.latitude && (
                  <p>Location: {photoExif.latitude.toFixed(6)}, {photoExif.longitude?.toFixed(6)}</p>
                )}
                {photoExif.dateTime && <p>Taken: {new Date(photoExif.dateTime).toLocaleString()}</p>}
                {photoExif.deviceModel && <p>Device: {photoExif.deviceMake} {photoExif.deviceModel}</p>}
              </div>
            )}

            <AIAnalysis
              result={aiResult}
              loading={aiLoading}
              error={aiError}
              onAccept={handleAIAccept}
              onOverride={() => {
                // Switch to form with current data so user can pick species manually
                setMode('form');
              }}
            />

            <button
              onClick={() => {
                // Go to form with all collected data
                if (aiResult && !editingSighting?.species) {
                  setEditingSighting(prev => ({
                    ...prev,
                    species: aiResult.species,
                    aiSpeciesGuess: aiResult.species,
                    aiConfidence: aiResult.confidence,
                    aiAlternatives: aiResult.alternatives,
                    sightingType: aiResult.sightingType,
                    count: aiResult.count,
                  }));
                }
                setMode('form');
              }}
              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-lg transition-colors"
            >
              Continue to Details
            </button>
          </div>
        </div>
      )}
    </>
  );
}
