import React from 'react';
import { Mic, ShieldCheck, X } from 'lucide-react';

export default function VoiceConsentModal({ onAllow, onDeny, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="voice-consent-modal">
      <div className="max-w-md w-full bg-slate-900 border border-violet-500/50 rounded-2xl p-6 shadow-2xl text-slate-100 relative">
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="w-12 h-12 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center mb-4">
          <Mic className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-violet-400" /> Voice Acoustic Analysis Consent
        </h3>
        <p className="text-sm text-slate-300 mb-4 leading-relaxed">
          Your voice may be analyzed for stress-related acoustic indicators (pitch variation, speech rhythm, and pauses). 
          <b> This is not a medical diagnosis.</b>
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={onAllow}
            data-testid="allow-voice-analysis-btn"
            className="w-full py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold shadow-lg text-sm"
          >
            Allow Voice Analysis
          </button>
          <button
            onClick={onDeny}
            data-testid="continue-text-only-btn"
            className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm border border-slate-700"
          >
            Continue With Text Only
          </button>
        </div>
      </div>
    </div>
  );
}
