export type TimePeriod = 'Dawn' | 'Morning' | 'Midday' | 'Afternoon' | 'Dusk' | 'Night';
export type Activity = 'Feeding' | 'Bedded' | 'Traveling' | 'Rutting' | 'Watering' | 'Unknown';
export type SightingType = 'LiveAnimal' | 'Tracks' | 'Scrape' | 'Rub' | 'Scat' | 'Wallow' | 'Bed' | 'Other';
export type SightingSource = 'Photo' | 'Manual' | 'TrailCam';
export type SyncStatus = 'pending' | 'synced' | 'conflict';

export interface SightingPhoto {
  id: string;
  localPath: string;
  remoteUrl?: string;
  uploaded: boolean;
}

export interface AIAlternative {
  species: string;
  confidence: number;
}

export interface Sighting {
  id: string;
  userId?: string;

  // Location
  latitude: number;
  longitude: number;
  altitude?: number;
  compassHeading?: number;

  // Time
  sightedAt: string; // ISO 8601
  timePeriod: TimePeriod;

  // Animal
  species: string;
  count: number;
  activity: Activity;
  sightingType: SightingType;

  // Weather
  weatherCondition?: string;
  temperature?: number;
  windSpeed?: number;
  windDirection?: string;
  humidity?: number;
  barometricPressure?: number;
  moonPhase?: string;
  sunrise?: string;
  sunset?: string;

  // AI
  aiSpeciesGuess?: string;
  aiConfidence?: number;
  aiAlternatives?: AIAlternative[];
  wasOverridden: boolean;

  // Media
  photos: SightingPhoto[];

  // User input
  notes?: string;
  source: SightingSource;
  isPublic: boolean;

  // Sync
  syncStatus: SyncStatus;
  deviceId?: string;
  clientUpdatedAt: string;

  // Meta
  createdAt: string;
  updatedAt: string;
}

export interface NewSighting extends Omit<Sighting, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'clientUpdatedAt'> {}

export interface WeatherData {
  condition: string;
  temperature: number;
  windSpeed: number;
  windDirection: string;
  humidity: number;
  barometricPressure: number;
  moonPhase: string;
  sunrise: string;
  sunset: string;
}

export interface AIAnalysisResult {
  species: string;
  confidence: number;
  alternatives: AIAlternative[];
  sightingType: SightingType;
  count: number;
  sex?: string;
  notes?: string;
}
