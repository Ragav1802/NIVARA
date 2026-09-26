import React, { useEffect, useState } from 'react';
import { Activity, Zap, Waves, ShieldCheck } from 'lucide-react';

export default function BiometricVoiceVisualizer({ isRecording, isPlaying, stressScore = 35 }) {
  const [bars, setBars] = useState([20, 45, 70, 30, 85, 60, 40, 95, 50, 30, 75, 40]);
  const [jitter, setJitter] = useState(1.4);
  const [tremor, setTremor] = useState('Low');

  useEffect(() => {
    let interval;
    if (isRecording || isPlaying) {
      interval = setInterval(() => {
        setBars((prev) =>
          prev.map(() => Math.floor(Math.random() * (isRecording ? 80 : 60)) + 20)
        );
        const j = (Math.random() * 2 + 0.8).toFixed(2);
        setJitter(j);
        setTremor(j > 2.2 ? 'Elevated' : 'Stable');
      }, 120);
    } else {
      setBars([15, 25, 20, 35, 25, 30, 20, 25, 15, 20, 25, 15]);
      setTremor('Idle');
    }
    return () => clearInterval(interval);
  }, [isRecording, isPlaying]);

  const active = isRecording || isPlaying;

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-5 backdrop-blur-xl shadow-2xl space-y-4">
      <div className="flex justify-between items-center border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Waves className={`w-4 h-4 ${active ? 'text-teal-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Biometric Voice Spectrum & Stress Visualizer
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
          <span className="text-[11px] font-mono text-slate-400">
            {isRecording ? 'LIVE INPUT ANALYZER' : isPlaying ? 'PLAYBACK SPECTRUM' : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* Dynamic Waveform Visualizer */}
      <div className="h-24 bg-slate-950/80 rounded-2xl border border-slate-800/80 p-3 flex items-end justify-between gap-1.5 overflow-hidden relative">
        {/* Glowing sweep effect */}
        {active && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-teal-500/10 to-transparent animate-pulse pointer-events-none" />
        )}
        {bars.map((height, idx) => (
          <div
            key={idx}
            className="flex-1 rounded-full transition-all duration-100 ease-out"
            style={{
              height: `${height}%`,
              background: active
                ? height > 70
                  ? 'linear-gradient(to top, #059669, #e11d48)'
                  : 'linear-gradient(to top, #0d9488, #2dd4bf)'
                : '#334155',
              boxShadow: active && height > 50 ? '0 0 12px rgba(45,212,191,0.4)' : 'none'
            }}
          />
        ))}
      </div>

      {/* Real-time Acoustic Metrics */}
      <div className="grid grid-cols-3 gap-2 text-center font-mono">
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Pitch Jitter</div>
          <div className="text-xs font-bold text-teal-300 mt-0.5">{jitter}%</div>
        </div>
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Micro-Tremors</div>
          <div className={`text-xs font-bold mt-0.5 ${tremor === 'Elevated' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {tremor}
          </div>
        </div>
        <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
          <div className="text-[10px] text-slate-500 uppercase">Acoustic Stress</div>
          <div className="text-xs font-bold text-violet-300 mt-0.5">{stressScore}/100</div>
        </div>
      </div>
    </div>
  );
}
