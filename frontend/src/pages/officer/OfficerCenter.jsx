import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from '@/contexts/AuthContext';
import { api, connectWS } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, Shield, Users, LogOut, Radio, MapPin, Activity, FileText, Sparkles } from 'lucide-react';
import SVIBadge from '@/components/SVIBadge';
import AIStressAssessmentSection from '@/components/AIStressAssessmentSection';
import AIEscalationRiskPredictor from '@/components/AIEscalationRiskPredictor';
import NotificationCenter from '@/components/NotificationCenter';

// Fix default icon

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
const emergencyIcon = new L.DivIcon({
  html: '<div style="width:24px;height:24px;border-radius:50%;background:#ff3b30;border:3px solid #fff;box-shadow:0 0 0 4px rgba(255,59,48,0.35);animation:pulse 1.5s infinite;"></div>',
  className: '', iconSize: [24, 24], iconAnchor: [12, 12],
});

export default function OfficerCenter() {
  const { user, logout } = useAuth();
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [counsellors, setCounsellors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [note, setNote] = useState('');
  const [chosenCounsellor, setChosenCounsellor] = useState('');
  const [center] = useState([12.9716, 77.5946]); // Bangalore default

  useEffect(() => {
    loadCases();
    api.get('/users/counsellors').then((r) => setCounsellors(r.data)).catch(() => {});
    const ws = connectWS((msg) => {
      if (msg.type === 'sos') {
        toast.error(`🚨 SOS from ${msg.victim_name}`, { duration: 8000 });
        setAlerts((a) => [msg, ...a].slice(0, 20));
        loadCases();
      } else if (msg.type === 'risk_escalation') {
        toast.warning(`Risk escalation: ${msg.victim_name} (SVI ${msg.svi_score})`);
        loadCases();
      }
    });
    const iv = setInterval(loadCases, 15000);
    return () => { if (ws) ws.close(); clearInterval(iv); };
    // eslint-disable-next-line
  }, []);

  const loadCases = async () => {
    try {
      const { data } = await api.get('/cases/mine');
      setCases(data);
    } catch {}
  };

  const openCase = async (c) => {
    setSelected(c);
    try { const { data } = await api.get(`/cases/${c.id}`); setDetail(data); }
    catch { toast.error('Could not load case'); }
  };

  const genSummary = async () => {
    if (!selected) return;
    toast.info('Generating summary…');
    try {
      const { data } = await api.post(`/cases/summary/${selected.id}`);
      setDetail((d) => ({ ...d, case: { ...d.case, summary: data.summary } }));
      toast.success('Summary generated');
    } catch { toast.error('Failed'); }
  };

  const assign = async () => {
    if (!chosenCounsellor || !selected) return;
    try {
      await api.post('/officer/assign', { case_id: selected.id, counsellor_id: chosenCounsellor, notes: note });
      toast.success('Assigned');
      setNote(''); setChosenCounsellor(''); loadCases(); openCase(selected);
    } catch { toast.error('Assignment failed'); }
  };

  const doAction = async (action) => {
    if (!selected) return;
    try {
      await api.post('/officer/action', { case_id: selected.id, action, notes: note });
      toast.success(`Action: ${action}`);
      setNote(''); openCase(selected);
    } catch { toast.error('Action failed'); }
  };

  const emergencyCases = useMemo(() => cases.filter((c) => c.priority === 'emergency' && c.status !== 'resolved'), [cases]);
  const mapPoints = useMemo(() => cases.filter((c) => c.latitude && c.longitude), [cases]);

  return (
    <div className="min-h-screen text-white officer-grid-bg font-officer-b">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-800 bg-black/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center"><Radio className="w-4 h-4" /></div>
          <div>
            <div className="font-officer-h text-lg font-black tracking-tight">LIVE RESPONSE CENTER</div>
            <div className="text-xs text-neutral-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Officer {user?.name} · On duty
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-neutral-400">
            <div>Emergencies: <b className="text-red-400">{emergencyCases.length}</b></div>
            <div>Active: <b className="text-blue-400">{cases.filter((c) => c.status !== 'resolved').length}</b></div>
          </div>
          <NotificationCenter />
          <button onClick={logout} data-testid="officer-logout" className="p-2 border border-neutral-700 rounded hover:bg-neutral-800"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 p-3 h-[calc(100vh-64px)]">
        {/* Left: priority queue */}
        <div className="col-span-3 flex flex-col gap-3 overflow-hidden">
          <div className="border border-neutral-800 rounded bg-neutral-950">
            <div className="font-officer-h px-3 py-2 border-b border-neutral-800 text-xs uppercase tracking-widest text-red-400 flex items-center gap-2">
              <Bell className="w-3 h-3" /> Priority Queue
            </div>
            <div className="max-h-[45vh] overflow-y-auto" data-testid="priority-queue">
              {emergencyCases.length === 0 && <div className="p-4 text-xs text-neutral-500">No active emergencies.</div>}
              {emergencyCases.map((c) => (
                <button key={c.id} onClick={() => openCase(c)} data-testid={`emerg-case-${c.id}`}
                  className={`w-full text-left p-3 border-b border-neutral-800 hover:bg-red-500/10 ${selected?.id === c.id ? 'bg-red-500/10' : ''}`}>
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-sm font-bold text-red-300">{c.victim_name}</div>
                    <SVIBadge score={c.svi_score} level={c.risk_level} size="sm" />
                  </div>
                  <div className="text-xs text-neutral-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {c.location_label || (c.latitude ? `${c.latitude.toFixed(3)}, ${c.longitude.toFixed(3)}` : 'no loc')}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-neutral-800 rounded bg-neutral-950 flex-1 overflow-hidden">
            <div className="font-officer-h px-3 py-2 border-b border-neutral-800 text-xs uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3 h-3" /> Active Cases
            </div>
            <div className="overflow-y-auto max-h-full" data-testid="active-cases">
              {cases.filter((c) => c.status !== 'resolved' && c.priority !== 'emergency').map((c) => (
                <button key={c.id} onClick={() => openCase(c)}
                  className={`w-full text-left p-3 border-b border-neutral-800 hover:bg-neutral-900 ${selected?.id === c.id ? 'bg-neutral-900' : ''}`}>
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-sm font-semibold">{c.victim_name}</div>
                    <SVIBadge score={c.svi_score} level={c.risk_level} size="sm" />
                  </div>
                  <div className="text-xs text-neutral-500">{c.status} · {new Date(c.updated_at).toLocaleTimeString()}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Map + Alerts feed */}
        <div className="col-span-6 flex flex-col gap-3">
          <div className="border border-neutral-800 rounded overflow-hidden flex-1" data-testid="officer-map">
            <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }} className="bg-neutral-900">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              />
              {mapPoints.map((c) => (
                <Marker key={c.id} position={[c.latitude, c.longitude]} icon={c.priority === 'emergency' ? emergencyIcon : L.Icon.Default.prototype}
                        eventHandlers={{ click: () => openCase(c) }}>
                  <Popup>
                    <div className="text-slate-900">
                      <div className="font-bold">{c.victim_name}</div>
                      <div className="text-xs">SVI {c.svi_score} · {c.risk_level}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
          <div className="border border-neutral-800 rounded bg-neutral-950 h-40 overflow-hidden">
            <div className="font-officer-h px-3 py-2 border-b border-neutral-800 text-xs uppercase tracking-widest">Realtime Feed</div>
            <div className="overflow-y-auto max-h-full">
              {alerts.length === 0 && <div className="p-3 text-xs text-neutral-500">Waiting for alerts…</div>}
              {alerts.map((a, i) => (
                <div key={i} className="px-3 py-2 border-b border-neutral-800 text-xs flex justify-between">
                  <span className="text-red-400">🚨 {a.victim_name} · SVI {a.svi_score}</span>
                  <span className="text-neutral-500">{new Date(a.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Case detail */}
        <div className="col-span-3 border border-neutral-800 rounded bg-neutral-950 flex flex-col overflow-hidden">
          <div className="font-officer-h px-3 py-2 border-b border-neutral-800 text-xs uppercase tracking-widest flex items-center gap-2">
            <FileText className="w-3 h-3" /> Case Detail
          </div>
          {!selected && <div className="p-4 text-xs text-neutral-500">Select a case</div>}
          {selected && detail && (
            <div className="overflow-y-auto flex-1 p-3 space-y-3 text-sm" data-testid="officer-case-detail">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-base">{detail.case.victim_name}</div>
                  <div className="text-xs text-neutral-400">{detail.case.status} · {new Date(detail.case.updated_at).toLocaleString()}</div>
                </div>
                <SVIBadge score={detail.case.svi_score} level={detail.case.risk_level} />
              </div>

              <AIStressAssessmentSection detail={detail} theme="dark" />

              <AIEscalationRiskPredictor caseId={detail.case.id} />


              {detail.case.summary && (
                <div className="p-3 bg-neutral-900 border border-neutral-800 rounded text-xs">
                  <div className="uppercase text-blue-400 mb-1 font-bold">Summary</div>
                  {detail.case.summary}
                </div>
              )}

              <div className="p-3 bg-neutral-900 border border-neutral-800 rounded max-h-40 overflow-y-auto">
                <div className="text-xs uppercase text-blue-400 mb-1 font-bold">Transcript</div>
                {detail.interactions.slice(-8).map((i) => (
                  <div key={i.id} className="text-[11px] mb-1">
                    <span className={`font-bold ${i.role === 'user' ? 'text-white' : 'text-emerald-400'}`}>{i.role}:</span> {i.content}
                  </div>
                ))}
              </div>

              <div className="p-3 bg-neutral-900 border border-neutral-800 rounded">
                <div className="text-xs uppercase text-blue-400 mb-2 font-bold">Actions</div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Notes…" data-testid="officer-notes"
                  className="w-full text-xs bg-neutral-800 border border-neutral-700 rounded p-2 mb-2 outline-none focus:border-blue-400" />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => doAction('contacted_victim')} data-testid="action-contact" className="text-xs py-1.5 bg-blue-500/20 border border-blue-500/40 rounded hover:bg-blue-500/30">Contacted</button>
                  <button onClick={() => doAction('dispatched_unit')} data-testid="action-dispatch" className="text-xs py-1.5 bg-amber-500/20 border border-amber-500/40 rounded hover:bg-amber-500/30">Dispatch</button>
                  <button onClick={genSummary} data-testid="gen-summary" className="text-xs py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded hover:bg-emerald-500/30 flex items-center justify-center gap-1"><Sparkles className="w-3 h-3" /> Summary</button>
                  <button onClick={() => doAction('closed_case')} data-testid="action-close" className="text-xs py-1.5 bg-neutral-800 border border-neutral-700 rounded hover:bg-neutral-700">Log</button>
                </div>
                <div className="mt-3 pt-3 border-t border-neutral-800">
                  <div className="text-xs uppercase text-blue-400 mb-2 font-bold flex items-center gap-1"><Users className="w-3 h-3" /> Assign counsellor</div>
                  <select value={chosenCounsellor} onChange={(e) => setChosenCounsellor(e.target.value)} data-testid="counsellor-select"
                    className="w-full text-xs bg-neutral-800 border border-neutral-700 rounded p-2 mb-2">
                    <option value="">Choose…</option>
                    {counsellors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={assign} disabled={!chosenCounsellor} data-testid="assign-btn"
                    className="w-full text-xs py-2 bg-blue-500 rounded hover:bg-blue-400 disabled:opacity-40 font-bold">Assign</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
