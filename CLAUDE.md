# ScoutLog

A mobile-first wildlife scouting app for hunters. Snap a photo, and the app logs GPS, time, weather, and AI-identified species automatically.

## Stack

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4
- **Native**: Capacitor 8 (iOS/Android App Store distribution)
- **Maps**: MapLibre GL JS (free, open-source)
- **Local DB**: localStorage (web) / SQLite via Capacitor (native)
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions)
- **AI**: Claude Haiku 4.5 vision (via Supabase Edge Function)
- **Weather**: Open-Meteo API (free, no key needed)
- **EXIF**: exifr (client-side extraction)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Start local Supabase
npx supabase start

# Reset DB with ScoutLog schema
npx supabase db reset
```

Local URLs:
- App: `http://localhost:3000`
- Supabase API: `http://127.0.0.1:54321`
- Supabase Studio: `http://127.0.0.1:54323`

## Environment Variables

Copy `.env.example` to `.env` and fill in:
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=your-anon-key
```

For AI analysis edge function:
```bash
npx supabase secrets set ANTHROPIC_API_KEY=your-key
```

## Project Structure

```
src/
├── main.tsx              # Entry point
├── App.tsx               # Router setup
├── components/           # UI components
│   ├── MapView.tsx       # MapLibre map with sighting pins
│   ├── SightingCard.tsx  # Slide-up detail card
│   ├── SightingForm.tsx  # New/edit sighting form
│   ├── PhotoCapture.tsx  # Camera/gallery picker
│   ├── AIAnalysis.tsx    # AI identification display
│   ├── FilterBar.tsx     # Species/date/time filters
│   ├── SightingsList.tsx # Chronological log
│   ├── Analytics.tsx     # Charts and stats
│   ├── SpeciesPicker.tsx # Species selection
│   └── Layout.tsx        # App shell + bottom nav
├── lib/                  # Core utilities
│   ├── db.ts             # Local database (CRUD)
│   ├── weather.ts        # Open-Meteo client
│   ├── exif.ts           # EXIF extraction
│   ├── ai.ts             # AI analysis client
│   ├── species.ts        # Species list + colors
│   ├── time.ts           # Time utilities
│   └── supabase.ts       # Supabase client
├── hooks/                # React hooks
│   ├── useSightings.ts   # Sighting CRUD
│   ├── useLocation.ts    # GPS position
│   └── useNetwork.ts     # Online/offline
├── pages/                # Route pages
│   ├── MapPage.tsx       # Map (home)
│   ├── LogPage.tsx       # Sightings list
│   ├── AnalyticsPage.tsx # Charts
│   └── SettingsPage.tsx  # Settings
└── types/
    └── index.ts          # TypeScript types
```

## Database Schema

Single migration: `supabase/migrations/20260402000001_scoutlog_schema.sql`

### `profiles` - User profiles (auto-created from auth)
### `sightings` - Wildlife sighting records with location, species, weather, AI data, photos

## Edge Functions

### `analyze-photo`
Sends photo to Claude Haiku 4.5 vision for wildlife identification.
- **Method**: POST
- **Body**: `{ image: string }` (base64 JPEG)
- **Response**: `{ species, confidence, alternatives, sightingType, count, sex, notes }`

## Key Features

- **Offline-first**: All data stored locally, syncs when online
- **Photo flow**: Camera → EXIF extraction → weather auto-fill → AI identification → confirm
- **Map view**: Color-coded species pins on MapLibre map (satellite/streets toggle)
- **Analytics**: Time-of-day activity, species breakdown, weather correlations
- **3-tap workflow**: Camera → confirm species → save
