import { useSightings } from '@/hooks/useSightings';
import Analytics from '@/components/Analytics';

export default function AnalyticsPage() {
  const { sightings } = useSightings();

  return (
    <div className="h-full overflow-y-auto bg-gray-900 pb-20">
      <div className="px-4 pt-4 mb-2">
        <h2 className="text-lg font-bold text-white">Patterns & Analytics</h2>
        <p className="text-xs text-gray-500">Insights from your sighting data</p>
      </div>
      <Analytics sightings={sightings} />
    </div>
  );
}
