import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Activity, ShieldAlert, Mic, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';
import SVIBadge from '@/components/SVIBadge';

export default function AIStressAssessmentSection({ detail, theme = 'dark' }) {
  const [expanded, setExpanded] = useState(true);

  if (!detail) return null;

  const assessment = detail.assessment || {};
  const voice = detail.voice_analysis || null;
  const recommendations = detail.recommendations || [];
  const latestAnalysis = detail.latest_analysis || {};
  const sviScore = assessment.final_svi ?? latestAnalysis.svi_score ?? detail.case?.svi_score ?? 0;
  const riskLevel = assessment.risk_level ?? latestAnalysis.risk_level ?? detail.case?.risk_level ?? 'Low';
  const indicators = assessment.indicators || latestAnalysis.indicators || [];
  const scoreBreakdown = assessment.score_breakdown || [];
  const disclaimer = detail.disclaimer || 'AI Recommendation — Human Review Required';

  const isDark = theme === 'dark';
  const bgCard = isDark ? 'bg-neutral-900 border-neutral-800 text-white' : 'bg-white border-stone-200 text-stone-900';
  const bgSub = isDark ? 'bg-neutral-950/80 border-neutral-800' : 'bg-stone-50 border-stone-200';
  const textMuted = isDark ? 'text-neutral-400' : 'text-stone-500';

  return (
    <div className={`border rounded-xl p-4 mb-4 ${bgCard}`} data-testid="ai-stress-assessment-section">
      <div 
        onClick={() => setExpanded(!expanded)} 
        className="flex items-center justify-between cursor-pointer select-none"
        data-testid="toggle-ai-assessment"
      >
        <div className="flex items-center gap-2 font-bold text-sm">
          <Activity className="w-4 h-4 text-violet-400" />
          <span>AI Stress & Vulnerability Assessment</span>
        </div>
        <div className="flex items-center gap-2">
          <SVIBadge score={sviScore} level={riskLevel} size="sm" />
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-3 border-t border-neutral-800 space-y-4 text-xs" data-testid="ai-assessment-details">
          {/* Disclaimer Banner */}
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="font-semibold">{disclaimer}</span>
          </div>

          {/* Scores Breakdown Row */}
          <div className="grid grid-cols-3 gap-2">
            <div className={`p-3 rounded-lg border text-center ${bgSub}`}>
              <div className={textMuted}>Text Risk</div>
              <div className="text-lg font-bold text-blue-400">{assessment.text_score ?? 'N/A'}</div>
            </div>
            <div className={`p-3 rounded-lg border text-center ${bgSub}`}>
              <div className={textMuted}>Voice Stress</div>
              <div className="text-lg font-bold text-violet-400">{assessment.voice_score ?? (voice ? voice.voice_stress_score : 'N/A')}</div>
            </div>
            <div className={`p-3 rounded-lg border text-center ${bgSub}`}>
              <div className={textMuted}>Safety Severity</div>
              <div className="text-lg font-bold text-red-400">{assessment.safety_score ?? 'N/A'}</div>
            </div>
          </div>

          {/* Contributing Factors Breakdown (Why SVI was generated) */}
          {scoreBreakdown.length > 0 && (
            <div className={`p-3 rounded-lg border ${bgSub}`}>
              <div className="font-semibold text-violet-300 mb-2 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> Contributing SVI Factors
              </div>
              <div className="space-y-1">
                {scoreBreakdown.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[11px]">
                    <span className={textMuted}>• {item.factor}</span>
                    <span className="font-mono font-bold text-violet-400">+{item.points} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acoustic Voice Features Grid (If available) */}
          {voice && (
            <div className={`p-3 rounded-lg border ${bgSub}`} data-testid="acoustic-voice-grid">
              <div className="font-semibold text-emerald-400 mb-2 flex items-center gap-1">
                <Mic className="w-3.5 h-3.5" /> Acoustic Voice Features
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>Mean Pitch: <b className="text-white">{voice.pitch_mean || 0} Hz</b></div>
                <div>Pitch Range: <b className="text-white">{voice.pitch_range || 0} Hz</b></div>
                <div>Speech Rate: <b className="text-white">{voice.speech_rate || 0} WPM</b></div>
                <div>Pause Count: <b className="text-white">{voice.pause_count || 0}</b></div>
                <div>Avg Pause: <b className="text-white">{voice.average_pause || 0} s</b></div>
                <div>Silence Ratio: <b className="text-white">{Math.round((voice.silence_ratio || 0) * 100)}%</b></div>
              </div>
              {voice.indicators && voice.indicators.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {voice.indicators.map((ind, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 text-[10px]">
                      {ind}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Safety & Trauma Indicators */}
          {indicators.length > 0 && (
            <div>
              <div className={`font-semibold mb-1.5 flex items-center gap-1 ${textMuted}`}>
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Detected Safety & Trauma Indicators
              </div>
              <div className="flex flex-wrap gap-1">
                {indicators.map((ind, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-medium">
                    {ind}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Automated Intervention Recommendations */}
          {recommendations.length > 0 && (
            <div>
              <div className={`font-semibold mb-2 flex items-center gap-1 ${textMuted}`}>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Automated Intervention Recommendations
              </div>
              <div className="space-y-1.5">
                {recommendations.map((rec, i) => (
                  <div key={i} className={`p-2.5 rounded-lg border ${bgSub} flex flex-col gap-0.5`}>
                    <div className="flex justify-between items-center font-semibold text-slate-200">
                      <span>{rec.type}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                        {rec.priority}
                      </span>
                    </div>
                    <p className={`text-[11px] ${textMuted}`}>{rec.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
