import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Heart, ArrowRight, Sparkles, Shield, Users } from 'lucide-react';

export default function Landing() {
  const nav = useNavigate();
  const { lang, setLang } = useAuth();

  return (
    <div className="min-h-screen font-victim relative overflow-hidden text-slate-100"
         style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1E293B 50%, #1a1032 100%)' }}>
      <div className="absolute inset-0 opacity-40 pointer-events-none"
           style={{ background: 'radial-gradient(circle at 20% 30%, rgba(196,181,253,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(138,154,91,0.3), transparent 45%)' }} />
      <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-8 py-6 relative z-10">
        <div className="flex items-center gap-2" data-testid="brand-logo">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-300 to-emerald-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Heart className="w-5 h-5 text-slate-900" />
          </div>
          <span className="text-xl font-extrabold tracking-tight">NIVARA</span>
        </div>
        <div className="flex items-center gap-3">
          <select value={lang} onChange={(e) => setLang(e.target.value)} data-testid="lang-select"
                  className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-sm">
            <option value="en">English</option>
            <option value="ta">தமிழ்</option>
            <option value="hi">हिन्दी</option>
          </select>
          <button onClick={() => nav('/auth')} data-testid="header-signin-btn"
                  className="px-4 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-800/60">
            {t(lang, 'signIn')}
          </button>
        </div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-8 pt-32 pb-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-400/30 text-violet-200 text-xs mb-6">
            <Sparkles className="w-3 h-3" /> AI companion for those who need to be heard
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05] tracking-tight" data-testid="landing-hero">
            <span className="block">Listen.</span>
            <span className="block text-violet-300">Understand.</span>
            <span className="block bg-gradient-to-r from-emerald-300 to-violet-300 bg-clip-text text-transparent">Support.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-2xl">{t(lang, 'heroSub')}</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <button onClick={() => nav('/auth?mode=signup&role=victim')} data-testid="cta-get-started"
                    className="group px-6 py-3.5 rounded-full bg-gradient-to-r from-violet-400 to-emerald-500 text-slate-900 font-bold flex items-center gap-2 hover:shadow-2xl hover:shadow-violet-500/30 hover:scale-[1.02]"
                    style={{ transition: 'transform 200ms, box-shadow 200ms' }}>
              {t(lang, 'getStarted')} <ArrowRight className="w-4 h-4 group-hover:translate-x-1" style={{ transition: 'transform 200ms' }} />
            </button>
            <button onClick={() => nav('/auth')} data-testid="cta-signin"
                    className="px-6 py-3.5 rounded-full border border-slate-600 hover:bg-slate-800/60 hover:border-violet-400">
              {t(lang, 'signIn')}
            </button>
          </div>
        </div>

        <div className="mt-24 grid md:grid-cols-3 gap-6">
          {[
            { icon: Heart, title: 'For those seeking support', body: 'A calm voice-first companion that listens, understands your language, and helps when things feel too heavy.', color: 'violet' },
            { icon: Shield, title: 'For officers', body: 'A live response center with real-time SOS alerts, victim location on the map, and AI risk assessment.', color: 'blue' },
            { icon: Users, title: 'For counsellors', body: 'A warm case-journey view — timelines, notes, follow-ups — everything you need to accompany someone.', color: 'amber' },
          ].map((c, i) => (
            <div key={i} data-testid={`role-card-${i}`}
                 className="p-6 rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-slate-800 hover:border-violet-400/40 hover:-translate-y-1"
                 style={{ transition: 'transform 220ms, border-color 220ms' }}>
              <c.icon className={`w-6 h-6 mb-4 text-${c.color}-300`} />
              <h3 className="text-lg font-bold mb-2">{c.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
