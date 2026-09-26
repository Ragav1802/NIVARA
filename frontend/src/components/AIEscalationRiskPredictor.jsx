import React, { useEffect, useState } from 'react';
import { TrendingUp, AlertTriangle, Clock, Activity, ShieldAlert, Zap } from 'lucide-react';
import { api } from '@/lib/api';

export default function AIEscalationRiskPredictor({ caseId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (caseId) loadPrediction();
  }, [caseId]);

  const loadPrediction = async () => {
    try {
      const res = await api.get(`/analytics/escalation-risk/${caseId}`);
      setData(res.data);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-3 bg-neutral-900 border border-neutral-800 rounded text-xs text-neutral-400">Loading AI Risk Forecast...</div>;
  }

  if (!data) return null;

  return (
    <div className="p-3 bg-neutral-900/90 border border-red-500/30 rounded-xl space-y-3 shadow-lg">
      <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-red-400">
          <Zap className="w-3.5 h-3.5 text-red-400 animate-pulse" />
          <span>AI ESCALATION RISK FORECAST (24-48H)</span>
        </div>
        <span className="text-[10px] font-mono bg-red-500/20 text-red-300 border border-red-500/40 px-2 py-0.5 rounded-full font-bold">
          {data.predicted_threat_level}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
          <div className="text-[10px] text-neutral-500 uppercase">Escalation Velocity</div>
          <div className="text-sm font-black text-amber-400 mt-0.5">{data.escalation_velocity}</div>
        </div>
        <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-800">
          <div className="text-[10px] text-neutral-500 uppercase">Danger Window</div>
          <div className="text-xs font-bold text-red-300 mt-0.5">21:00 - 02:00</div>
        </div>
      </div>

      {/* 24-48H Predictive Timeline Curve */}
      <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 space-y-1.5">
        <div className="text-[10px] font-bold text-neutral-400 uppercase flex items-center justify-between">
          <span>Forecast SVI Trajectory</span>
          <span className="text-red-400">+26% in 24h</span>
        </div>
        <div className="flex items-end justify-between gap-1 h-12 pt-2">
          {data.risk_curve?.map((pt, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-full rounded-t ${
                  i >= 3 ? 'bg-gradient-to-t from-red-600 to-rose-400' : 'bg-gradient-to-t from-neutral-700 to-blue-400'
                }`}
                style={{ height: `${Math.max(15, pt.score)}%` }}
              />
              <span className="text-[9px] font-mono text-neutral-500">{pt.time.replace(' (Forecast)', '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Primary Threat Risk Factors */}
      <div className="space-y-1">
        <div className="text-[10px] text-neutral-400 uppercase font-semibold">Top Threat Drivers:</div>
        {data.risk_factors?.map((rf, idx) => (
          <div key={idx} className="flex justify-between items-center text-[11px] text-neutral-300">
            <span>• {rf.factor}</span>
            <span className="font-mono text-red-400 font-bold">{rf.weight}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
