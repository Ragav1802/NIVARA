import React, { useEffect } from 'react';
import '@/App.css';
import '@/index.css';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Landing from '@/pages/Landing';
import AuthPage from '@/pages/AuthPage';
import VictimHome from '@/pages/victim/VictimHome';
import OfficerCenter from '@/pages/officer/OfficerCenter';
import CounsellorJourney from '@/pages/counsellor/CounsellorJourney';

function RoleGate() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user) { nav('/auth', { replace: true }); return; }
    if (user.role === 'victim') nav('/victim', { replace: true });
    else if (user.role === 'officer') nav('/officer', { replace: true });
    else if (user.role === 'counsellor') nav('/counsellor', { replace: true });
  }, [user, loading, nav]);
  return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
}

function Protected({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== role) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors closeButton />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/app" element={<RoleGate />} />
          <Route path="/victim" element={<Protected role="victim"><VictimHome /></Protected>} />
          <Route path="/officer" element={<Protected role="officer"><OfficerCenter /></Protected>} />
          <Route path="/counsellor" element={<Protected role="counsellor"><CounsellorJourney /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
