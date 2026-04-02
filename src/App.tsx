import { Routes, Route, Navigate } from 'react-router-dom';
import { CameraProvider } from './lib/camera-context';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import MapPage from './pages/MapPage';
import LogPage from './pages/LogPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <CameraProvider>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<MapPage />} />
            <Route path="/log" element={<LogPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </CameraProvider>
  );
}
