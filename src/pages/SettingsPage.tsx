import { useState } from 'react';
import { useNetwork } from '@/hooks/useNetwork';
import { useSightings } from '@/hooks/useSightings';
import { clearAllSightings } from '@/lib/db';

const TEMP_UNIT_KEY = 'scoutlog_temp_unit';

export default function SettingsPage() {
  const { online } = useNetwork();
  const { sightings } = useSightings();
  const [tempUnit, setTempUnit] = useState(() => localStorage.getItem(TEMP_UNIT_KEY) ?? 'F');

  const pendingSync = sightings.filter(s => s.syncStatus === 'pending').length;
  const totalPhotos = sightings.reduce((sum, s) => sum + s.photos.length, 0);

  return (
    <div className="h-full overflow-y-auto bg-gray-900 pb-20">
      <div className="px-4 pt-4 mb-4">
        <h2 className="text-lg font-bold text-white">Settings</h2>
      </div>

      <div className="px-4 space-y-3">
        {/* Sync Status */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-2">Sync Status</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-3 h-3 rounded-full ${online ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-sm text-gray-300">{online ? 'Online' : 'Offline'}</span>
          </div>
          <div className="text-sm text-gray-400 space-y-1">
            <p>{sightings.length} total sightings</p>
            <p>{pendingSync} pending sync</p>
            <p>{totalPhotos} photos</p>
          </div>
        </div>

        {/* Account */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-2">Account</h3>
          <p className="text-sm text-gray-400 mb-3">Sign in to sync data across devices and back up your sightings.</p>
          <button className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors">
            Sign In (Coming Soon)
          </button>
        </div>

        {/* Subscription */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-2">Subscription</h3>
          <p className="text-sm text-gray-400 mb-1">Current plan: <span className="text-green-400">Free</span></p>
          <p className="text-xs text-gray-500">Premium features coming soon.</p>
        </div>

        {/* Preferences */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3">Preferences</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Temperature Unit</span>
              <select
                value={tempUnit}
                onChange={e => { setTempUnit(e.target.value); localStorage.setItem(TEMP_UNIT_KEY, e.target.value); }}
                className="bg-gray-700 text-white text-sm rounded px-2 py-1"
              >
                <option value="F">°F</option>
                <option value="C">°C</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Default Privacy</span>
              <span className="text-sm text-green-400">Private</span>
            </div>
          </div>
        </div>

        {/* Data */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-3">Data</h3>
          <button
            onClick={() => {
              const data = JSON.stringify(sightings, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `scoutlog-export-${new Date().toISOString().split('T')[0]}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors mb-2"
          >
            Export Data (JSON)
          </button>
          <button
            onClick={() => {
              if (confirm('Delete all sightings? This cannot be undone.')) {
                clearAllSightings();
              }
            }}
            className="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-sm font-medium transition-colors"
          >
            Delete All Data
          </button>
        </div>

        {/* About */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="text-white font-semibold mb-1">ScoutLog</h3>
          <p className="text-xs text-gray-500">v0.1.0 — Wildlife Scouting Tracker</p>
          <p className="text-xs text-gray-600 mt-1">All data stored locally on your device.</p>
        </div>
      </div>
    </div>
  );
}
