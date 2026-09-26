import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';
import { Heart } from 'lucide-react';

export default function AuthPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { login, register, lang, setLang } = useAuth();
  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [role, setRole] = useState(params.get('role') || 'victim');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.get('mode') === 'signup') setMode('signup');
  }, [params]);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = mode === 'signin'
        ? await login(form.email, form.password)
        : await register({ ...form, role, language: lang });
      toast.success(mode === 'signin' ? 'Welcome back' : 'Account created');
      nav(u.role === 'victim' ? '/victim' : u.role === 'officer' ? '/officer' : '/counsellor', { replace: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Something went wrong');
    } finally { setLoading(false); }
  };

  const quickFill = (email) => setForm({ email, password: 'Password123', name: '' });

  return (
    <div className="min-h-screen font-victim text-slate-100 flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1E293B 60%, #1a1032 100%)' }}>
      <div className="w-full max-w-md">
        <button onClick={() => nav('/')} data-testid="auth-back" className="flex items-center gap-2 mb-6 text-slate-400 hover:text-white">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-300 to-emerald-500 flex items-center justify-center">
            <Heart className="w-4 h-4 text-slate-900" />
          </div>
          <span className="font-extrabold">NIVARA</span>
        </button>

        <div className="bg-slate-900/70 backdrop-blur-xl border border-slate-800 rounded-2xl p-8">
          <div className="flex gap-1 p-1 rounded-full bg-slate-800/70 mb-6">
            {['signin', 'signup'].map((m) => (
              <button key={m} onClick={() => setMode(m)} data-testid={`tab-${m}`}
                className={`flex-1 py-2 rounded-full text-sm font-semibold ${mode === m ? 'bg-violet-400 text-slate-900' : 'text-slate-400'}`}>
                {m === 'signin' ? t(lang, 'signIn') : t(lang, 'signUp')}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <input type="text" required data-testid="input-name" placeholder={t(lang, 'name')}
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 focus:border-violet-400 outline-none" />
                <div>
                  <div className="text-xs text-slate-400 mb-2">{t(lang, 'role')}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {['victim', 'officer', 'counsellor'].map((r) => (
                      <button key={r} type="button" onClick={() => setRole(r)} data-testid={`role-${r}`}
                        className={`py-2 rounded-lg text-xs font-semibold ${role === r ? 'bg-violet-400 text-slate-900' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                        {t(lang, r)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <input type="email" required data-testid="input-email" placeholder={t(lang, 'email')}
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 focus:border-violet-400 outline-none" />
            <input type="password" required data-testid="input-password" placeholder={t(lang, 'password')}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 focus:border-violet-400 outline-none" />
            <button type="submit" disabled={loading} data-testid="submit-btn"
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-400 to-emerald-500 text-slate-900 font-bold hover:shadow-lg hover:shadow-violet-500/30 disabled:opacity-60">
              {loading ? '…' : mode === 'signin' ? t(lang, 'signIn') : t(lang, 'signUp')}
            </button>
          </form>

          {mode === 'signin' && (
            <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-400">
              <div className="mb-2 font-semibold text-slate-300">Try a demo account:</div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['victim@nivara.app', 'Victim'],
                  ['officer@nivara.app', 'Officer'],
                  ['counsellor@nivara.app', 'Counsellor'],
                ].map(([em, label]) => (
                  <button key={em} type="button" onClick={() => quickFill(em)} data-testid={`demo-${label.toLowerCase()}`}
                    className="px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 hover:border-violet-400">{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
