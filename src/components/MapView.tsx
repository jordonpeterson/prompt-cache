import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useLocation } from '@/hooks/useLocation';
import { getSpeciesColor, getSpeciesInfo } from '@/lib/species';
import type { Sighting } from '@/types';

interface MapViewProps {
  sightings: Sighting[];
  onPinClick: (sighting: Sighting) => void;
  onMapClick: (lat: number, lng: number) => void;
  selectedId?: string;
}

export default function MapView({ sightings, onPinClick, onMapClick, selectedId }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const { location } = useLocation();
  const [mapReady, setMapReady] = useState(false);
  const [style, setStyle] = useState<'streets' | 'satellite'>('streets');

  // Refs to avoid stale closures in map event handlers
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  const onPinClickRef = useRef(onPinClick);
  useEffect(() => { onPinClickRef.current = onPinClick; }, [onPinClick]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const initialCenter: [number, number] = location
      ? [location.longitude, location.latitude]
      : [-98.5795, 39.8283]; // Center of US as fallback

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: getStyleUrl(style),
      center: initialCenter,
      zoom: location ? 12 : 4,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );

    map.current.on('load', () => setMapReady(true));

    map.current.on('click', (e) => {
      // Only trigger if not clicking on a marker
      const target = e.originalEvent.target as HTMLElement | null;
      if (target?.closest?.('.sighting-marker')) return;
      onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when sightings change
  const updateMarkers = useCallback(() => {
    if (!map.current || !mapReady) return;

    // Clear existing markers
    markers.current.forEach(m => m.remove());
    markers.current = [];

    sightings.forEach(sighting => {
      const info = getSpeciesInfo(sighting.species);
      const isSelected = sighting.id === selectedId;

      const el = document.createElement('div');
      el.className = 'sighting-marker';
      el.style.cssText = `
        width: ${isSelected ? '44px' : '36px'};
        height: ${isSelected ? '44px' : '36px'};
        border-radius: 50%;
        background: ${getSpeciesColor(sighting.species)};
        border: 3px solid ${isSelected ? '#fff' : 'rgba(255,255,255,0.5)'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${isSelected ? '20px' : '16px'};
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        ${isSelected ? 'z-index: 10;' : ''}
      `;
      el.textContent = info.emoji;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPinClickRef.current(sighting);
      });

      // Badge for count > 1
      if (sighting.count > 1) {
        const countText = sighting.count > 99 ? '99+' : String(sighting.count);
        const badgeWidth = countText.length > 2 ? '22px' : '16px';
        const badge = document.createElement('span');
        badge.style.cssText = `
          position: absolute; top: -4px; right: -4px;
          background: #e94560; color: white; font-size: 10px;
          min-width: ${badgeWidth}; height: 16px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-weight: bold; padding: 0 2px;
        `;
        badge.textContent = countText;
        el.style.position = 'relative';
        el.appendChild(badge);
      }

      // Photo indicator
      if (sighting.photos.length > 0) {
        const cam = document.createElement('span');
        cam.style.cssText = `
          position: absolute; bottom: -4px; right: -4px;
          background: #4a7c28; color: white; font-size: 8px;
          width: 14px; height: 14px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
        `;
        cam.textContent = '📷';
        el.style.position = 'relative';
        el.appendChild(cam);
      }

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([sighting.longitude, sighting.latitude])
        .addTo(map.current!);

      markers.current.push(marker);
    });
  }, [sightings, selectedId, mapReady]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  // Toggle map style
  const toggleStyle = useCallback(() => {
    const next = style === 'streets' ? 'satellite' : 'streets';
    setStyle(next);
    map.current?.setStyle(getStyleUrl(next));
  }, [style]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Style toggle */}
      <button
        onClick={toggleStyle}
        className="absolute top-3 left-3 bg-gray-800/90 text-white px-3 py-1.5 rounded-lg text-sm font-medium backdrop-blur-sm border border-gray-600 hover:bg-gray-700 transition-colors z-10"
      >
        {style === 'streets' ? '🛰 Satellite' : '🗺 Streets'}
      </button>
    </div>
  );
}

function getStyleUrl(style: 'streets' | 'satellite'): string {
  if (style === 'satellite') {
    // Free Esri World Imagery raster tiles — no API key needed
    return {
      version: 8 as const,
      sources: {
        'esri-satellite': {
          type: 'raster' as const,
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Esri, Maxar, Earthstar Geographics',
          maxzoom: 18,
        },
      },
      layers: [
        {
          id: 'esri-satellite-layer',
          type: 'raster' as const,
          source: 'esri-satellite',
        },
      ],
    } as maplibregl.StyleSpecification as unknown as string;
  }
  // OpenFreeMap - completely free, no key needed
  return 'https://tiles.openfreemap.org/styles/liberty';
}
