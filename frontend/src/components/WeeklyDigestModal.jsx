import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Calendar, CheckCircle2, ShieldAlert, Sparkles, X, FileText, Activity, UserCheck } from 'lucide-react';
import SVIBadge from './SVIBadge';

export default function WeeklyDigestModal({ isOpen, onClose }) {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDigest();
    }
  }, [isOpen]);

  const loadDigest = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/counsellor/weekly-digest');
      setDigest(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-amber-500/20 via-slate-800 to-indigo-500/20 border-b border-slate-700/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Sunday Weekly Case Digest
              </h2>
              <p className="text-xs text-slate-400">
                {digest?.date || 'Sunday Digest & Progress Summary'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm animate-pulse">
              Generating your Sunday Weekly Digest...
            </div>
          ) : digest ? (
            <>
              {/* Summary Card */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm leading-relaxed flex items-start space-x-3">
                <FileText className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-300 mb-1">Weekly Overview</div>
                  {digest.summary}
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-center">
                  <div className="text-2xl font-black text-cyan-400">{digest.total_cases}</div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">Total Cases</div>
                </div>
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-center">
                  <div className="text-2xl font-black text-amber-400">{digest.active_cases_count}</div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">Active</div>
                </div>
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-center">
                  <div className="text-2xl font-black text-red-400">{digest.high_risk_count}</div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">High SVI</div>
                </div>
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-xl text-center">
                  <div className="text-2xl font-black text-emerald-400">{digest.resolved_cases_count}</div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">Resolved</div>
                </div>
              </div>

              {/* Active Cases Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" /> Active Assigned Cases ({digest.active_cases.length})
                </h3>
                {digest.active_cases.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">No active cases right now.</div>
                ) : (
                  <div className="space-y-2">
                    {digest.active_cases.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 bg-slate-800/40 border border-slate-700/40 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-200">{c.title}</div>
                          <div className="text-xs text-slate-400 mt-0.5">Status: <span className="text-cyan-300 font-medium capitalize">{c.status}</span></div>
                        </div>
                        <SVIBadge score={c.svi_score} level={c.risk_level} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming Followups Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-400" /> Upcoming Scheduled Follow-ups ({digest.upcoming_followups.length})
                </h3>
                {digest.upcoming_followups.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">No scheduled follow-ups.</div>
                ) : (
                  <div className="space-y-2">
                    {digest.upcoming_followups.map((f) => (
                      <div
                        key={f.id}
                        className="p-3 bg-slate-800/40 border border-slate-700/40 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-200">{f.notes || 'Routine Follow-up'}</div>
                          <div className="text-slate-400 text-[11px] mt-0.5">Channel: {f.channel}</div>
                        </div>
                        <div className="text-right text-amber-300 font-medium">
                          {new Date(f.scheduled_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-400 text-sm">
              Failed to load Sunday digest.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition-all"
          >
            Close Summary
          </button>
        </div>
      </div>
    </div>
  );
}
