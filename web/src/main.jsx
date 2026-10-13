import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { ProtectedRoute, PublicOnlyRoute } from './auth/ProtectedRoute.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { PublicDemoPage, StartDemoPage } from './pages/DemoPages.jsx';
import './styles.css';

// Map pages pull in Leaflet; load them on demand so sign-in stays light.
const SessionPage = lazy(() => import('./pages/SessionPage.jsx').then((m) => ({ default: m.SessionPage })));
const ReplayPage = lazy(() => import('./pages/ReplayPage.jsx').then((m) => ({ default: m.ReplayPage })));
const SharePage = lazy(() => import('./pages/SharePage.jsx').then((m) => ({ default: m.SharePage })));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="center muted">Loading…</div>}>
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/demo" element={<PublicDemoPage />} />
            <Route path="/share/:token" element={<SharePage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/sessions/:sessionId" element={<SessionPage />} />
              <Route path="/sessions/:sessionId/replay" element={<ReplayPage />} />
              <Route path="/start-demo" element={<StartDemoPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
