import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, connectWS } from '@/lib/api';
import { toast } from 'sonner';
import { BookOpen, LogOut, Sparkles, Calendar, CheckCircle2, MessageSquare, TrendingUp, Send, ShieldAlert, HeartHandshake, Zap } from 'lucide-react';
import SVIBadge from '@/components/SVIBadge';
import AIStressAssessmentSection from '@/components/AIStressAssessmentSection';
import AIEscalationRiskPredictor from '@/components/AIEscalationRiskPredictor';

export default function CounsellorJourney() {
  const { user, logout } = useAuth();
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [support, setSupport] = useState('');
  const [progress, setProgress] = useState('ongoing');
  const [followAt, setFollowAt] = useState('');
  const [followNote, setFollowNote] = useState('');
  const [liveIntervention, setLiveIntervention] = useState('');
  const [sendingIntervention, setSendingIntervention] = useState(false);

  useEffect(() => {
    load();
    const ws = connectWS((msg) => {
      if (msg.type === 'case_assigned') { toast.success('New case assigned to you'); load(); }
    });
    return () => ws && ws.close();
  }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/cases/mine');
      setCases(data);
      if (selected) openCase(data.find((c) => c.id === selected.id) || null);
    } catch {}
  };

  const openCase = async (c) => {
    setSelected(c);
    if (!c) { setDetail(null); return; }
    try { const { data } = await api.get(`/cases/${c.id}`); setDetail(data); } catch {}
  };

  const sendLiveIntervention = async (customMsg = null) => {
    const msg = customMsg || liveIntervention;
    if (!msg.trim() || !selected) return;
    setSendingIntervention(true);
    try {
      await api.post('/counsellor/intervene', { case_id: selected.id, message: msg.trim() });
      toast.success('Live intervention delivered to victim app');
      setLiveIntervention('');
      openCase(selected);
    } catch {
      toast.error('Failed to deliver intervention');
    } finally {
      setSendingIntervention(false);
    }
  };

  const genSummary = async () => {
    if (!selected) return;
    toast.info('Weaving summary…');
    try {
      const { data } = await api.post(`/cases/summary/${selected.id}`);
      setDetail((d) => ({ ...d, case: { ...d.case, summary: data.summary } }));
      toast.success('Summary ready');
    } catch { toast.error('Failed'); }
  };

  const submitNote = async () => {
    if (!note.trim() || !selected) return;
    try {
      await api.post('/counsellor/note', { case_id: selected.id, note, support_provided: support, progress });
      toast.success('Note saved');
      setNote(''); setSupport('');
      openCase(selected);
    } catch { toast.error('Failed to save'); }
  };

  const scheduleFollow = async () => {
    if (!followAt || !selected) return;
    try {
      await api.post('/counsellor/followup', {
        case_id: selected.id, scheduled_at: new Date(followAt).toISOString(),
        channel: 'in-app', notes: followNote,
      });
      toast.success('Follow-up scheduled');
      setFollowAt(''); setFollowNote(''); openCase(selected);
    } catch { toast.error('Failed'); }
  };

  const resolve = async () => {
    if (!selected) return;
    try {
      await api.post('/case/status', { case_id: selected.id, status: 'resolved' });
      toast.success('Case resolved');
      load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="min-h-screen font-counsellor-b" style={{ backgroundColor: '#FAFAF9', color: '#1C1917' }}>
      <div className="border-b" style={{ borderColor: '#E7E5E4', background: 'linear-gradient(90deg, #FEF3C7 0%, #FED7AA 100%)' }}>
        <div className="max-w-7xl mx-auto px-8 py-5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#B45309' }}>
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-counsellor-h text-2xl font-bold" style={{ color: '#78350F' }}>Case Journey</h1>
              <p className="text-xs text-stone-600">Every story deserves a caring witness — welcome, {user?.name}</p>
            </div>
          </div>
          <button onClick={logout} data-testid="counsellor-logout" className="p-2 rounded-lg hover:bg-white/50"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-8 grid grid-cols-12 gap-8">
        {/* Case list */}
        <aside className="col-span-4">
          <h2 className="font-counsellor-h text-xl mb-4 font-semibold">Your assigned cases</h2>
          {cases.length === 0 && <p className="text-stone-500 italic">Cases will appear here when an officer assigns them to you.</p>}
          <div className="space-y-3" data-testid="counsellor-case-list">
            {cases.map((c) => (
              <button key={c.id} onClick={() => openCase(c)} data-testid={`case-${c.id}`}
                className={`w-full text-left p-5 rounded-2xl bg-white border-2 hover:shadow-lg ${selected?.id === c.id ? 'border-amber-500 shadow-md' : 'border-stone-200'}`}
                style={{ transition: 'box-shadow 200ms, border-color 200ms' }}>
                <div className="flex justify-between items-start mb-2">
                  <div className="font-counsellor-h font-bold text-lg">{c.victim_name}</div>
                  <SVIBadge score={c.svi_score} level={c.risk_level} />
                </div>
                <div className="text-xs text-stone-500">Status: <span className="font-semibold text-amber-700">{c.status}</span></div>
                <div className="text-xs text-stone-500 mt-1">Updated {new Date(c.updated_at).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="col-span-8">
          {!selected && (
            <div className="text-center py-20 text-stone-400">
              <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p>Select a case to begin their journey</p>
            </div>
          )}
          {selected && detail && (
            <div data-testid="counsellor-case-detail">
              <div className="mb-8 p-6 bg-white rounded-3xl border border-stone-200 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="font-counsellor-h text-3xl font-bold" style={{ color: '#78350F' }}>{detail.case.victim_name}'s journey</h2>
                    <div className="text-sm text-stone-500 mt-1">Opened {new Date(detail.case.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <SVIBadge score={detail.case.svi_score} level={detail.case.risk_level} size="lg" />
                  </div>
                </div>

                {detail.case.summary ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-sm italic text-stone-700">
                    "{detail.case.summary}"
                  </div>
                ) : (
                  <button onClick={genSummary} data-testid="counsellor-gen-summary"
                    className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 font-semibold">
                    <Sparkles className="w-4 h-4" /> Generate AI Summary
                  </button>
                )}
              </div>

              <AIStressAssessmentSection detail={detail} theme="light" />

              <div className="mb-8">
                <AIEscalationRiskPredictor caseId={detail.case.id} />
              </div>

              {/* AI Crisis Co-Pilot Intervention Bridge */}
              <div className="mb-8 p-6 bg-amber-500/10 border-2 border-amber-500/40 rounded-3xl space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 font-bold text-amber-900 text-base">
                    <HeartHandshake className="w-5 h-5 text-amber-600" />
                    <span>Live Counselor AI Co-Pilot Intervention Bridge</span>
                  </div>
                  <span className="text-xs bg-amber-200 text-amber-900 px-2.5 py-0.5 rounded-full font-semibold">
                    Direct App Drop-In
                  </span>
                </div>
                <p className="text-xs text-stone-600">
                  Send high-priority direct messages into the victim's live app conversation. Recommended phrases generated by AI Co-Pilot:
                </p>

                <div className="flex flex-wrap gap-2">
                  {[
                    "You are completely safe right now. Take a deep breath with me.",
                    "Would you like me to guide you to the nearest 24/7 safe shelter nearby?",
                    "I am here with you. We have officers monitoring your location."
                  ].map((phrase, i) => (
                    <button
                      key={i}
                      onClick={() => sendLiveIntervention(phrase)}
                      className="text-xs bg-white hover:bg-amber-100 border border-amber-300 text-amber-950 px-3 py-1.5 rounded-full font-medium shadow-sm transition"
                    >
                      ⚡ "{phrase}"
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 items-center pt-2">
                  <input
                    value={liveIntervention}
                    onChange={(e) => setLiveIntervention(e.target.value)}
                    placeholder="Write a custom crisis intervention message to victim..."
                    className="flex-1 p-3 text-xs bg-white border border-amber-300 rounded-xl outline-none focus:border-amber-600"
                  />
                  <button
                    onClick={() => sendLiveIntervention()}
                    disabled={sendingIntervention || !liveIntervention.trim()}
                    className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow disabled:opacity-40 transition"
                  >
                    <Send className="w-3.5 h-3.5" /> Intervene
                  </button>
                </div>
              </div>

              {/* Timeline */}

              <div className="mb-8">
                <h3 className="font-counsellor-h text-xl font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Timeline</h3>
                <div className="relative pl-8 border-l-2 border-amber-200 space-y-4" data-testid="case-timeline">
                  {[...detail.interactions.map((i) => ({ ...i, kind: 'msg' })),
                    ...detail.actions.map((a) => ({ ...a, kind: 'action', content: a.action, created_at: a.created_at })),
                    ...detail.notes.map((n) => ({ ...n, kind: 'note', content: n.note, created_at: n.created_at }))]
                    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
                    .slice(-15)
                    .map((e, i) => (
                      <div key={i} className="relative">
                        <div className={`absolute -left-[38px] top-1 w-4 h-4 rounded-full timeline-dot ${
                          e.kind === 'msg' ? 'bg-stone-400' : e.kind === 'action' ? 'bg-blue-500' : 'bg-amber-500'
                        }`} />
                        <div className="text-xs text-stone-500 mb-1">
                          {new Date(e.created_at).toLocaleString()} · {e.kind === 'msg' ? `${e.role} message` : e.kind === 'action' ? 'Officer action' : 'Your note'}
                        </div>
                        <div className="p-3 rounded-xl bg-white border border-stone-200 text-sm">{e.content}</div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Note form */}
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="p-6 bg-white rounded-2xl border border-stone-200">
                  <h3 className="font-counsellor-h font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Add Counselling Note</h3>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="What did you observe? What did you say?"
                    data-testid="note-content"
                    className="w-full p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm outline-none focus:border-amber-500" />
                  <input value={support} onChange={(e) => setSupport(e.target.value)} placeholder="Support provided (e.g., coping strategies)"
                    data-testid="note-support"
                    className="w-full mt-3 p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm outline-none focus:border-amber-500" />
                  <select value={progress} onChange={(e) => setProgress(e.target.value)} data-testid="note-progress"
                    className="w-full mt-3 p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm">
                    <option value="ongoing">Ongoing</option>
                    <option value="improving">Improving</option>
                    <option value="stabilised">Stabilised</option>
                    <option value="resolved">Ready to resolve</option>
                  </select>
                  <button onClick={submitNote} data-testid="save-note"
                    className="w-full mt-3 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">Save Note</button>
                </div>

                <div className="p-6 bg-white rounded-2xl border border-stone-200">
                  <h3 className="font-counsellor-h font-semibold mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Schedule Follow-up</h3>
                  <input type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} data-testid="follow-date"
                    className="w-full p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm" />
                  <textarea value={followNote} onChange={(e) => setFollowNote(e.target.value)} rows={2} placeholder="Follow-up focus"
                    data-testid="follow-note"
                    className="w-full mt-3 p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm outline-none focus:border-amber-500" />
                  <button onClick={scheduleFollow} data-testid="schedule-follow"
                    className="w-full mt-3 py-2.5 rounded-lg bg-stone-800 hover:bg-stone-900 text-white font-semibold">Schedule</button>
                  <button onClick={resolve} data-testid="resolve-case"
                    className="w-full mt-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Mark Resolved
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
