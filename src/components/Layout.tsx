import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useNetwork } from '@/hooks/useNetwork';

interface Tab {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isCenter?: boolean;
}

const tabs: Tab[] = [
  { to: '/', label: 'Map', icon: MapIcon },
  { to: '/log', label: 'Log', icon: ListIcon },
  { to: '/camera', label: '', icon: CameraIcon, isCenter: true },
  { to: '/analytics', label: 'Stats', icon: ChartIcon },
  { to: '/settings', label: 'Settings', icon: GearIcon },
];

export default function Layout() {
  const { online } = useNetwork();
  const navigate = useNavigate();

  const handleCameraClick = () => {
    // Navigate to map page and trigger camera
    navigate('/');
    setTimeout(() => {
      const openCamera = (window as unknown as Record<string, unknown>).__scoutlog_open_camera;
      if (typeof openCamera === 'function') {
        (openCamera as () => void)();
      }
    }, 100);
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 z-50">
        <h1 className="text-lg font-bold text-green-400 tracking-wide">ScoutLog</h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <span className="text-xs text-gray-400">{online ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden relative">
        <Outlet />
      </div>

      {/* Bottom navigation */}
      <nav className="flex items-end justify-around bg-gray-800 border-t border-gray-700 px-2 pb-[env(safe-area-inset-bottom)] z-50">
        {tabs.map(tab =>
          tab.isCenter ? (
            <button
              key={tab.to}
              onClick={handleCameraClick}
              className="flex flex-col items-center py-2 px-3"
            >
              <div className="w-14 h-14 -mt-6 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center shadow-lg shadow-green-900/50 transition-colors">
                <tab.icon className="w-7 h-7 text-white" />
              </div>
            </button>
          ) : (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex flex-col items-center py-2 px-3 transition-colors ${
                  isActive ? 'text-green-400' : 'text-gray-500 hover:text-gray-300'
                }`
              }
            >
              <tab.icon className="w-6 h-6" />
              <span className="text-[10px] mt-0.5">{tab.label}</span>
            </NavLink>
          )
        )}
      </nav>
    </div>
  );
}

// Simple inline SVG icons
function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
      <path d="M8 2v16" />
      <path d="M16 6v16" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
