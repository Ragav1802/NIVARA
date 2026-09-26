import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, connectWS } from '@/lib/api';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';
import { 
  Mic, MicOff, MessageCircle, AlertTriangle, ClipboardList, Bell, 
  Settings as SettingsIcon, LogOut, Send, X, Volume2, Shield, 
  EyeOff, Download, Sparkles, Activity, FileText, Lock, Globe, Flame,
  Radio, ShieldCheck, Camera, UserCheck, HeartPulse
} from 'lucide-react';
import SVIBadge from '@/components/SVIBadge';
import VoiceConsentModal from '@/components/VoiceConsentModal';
import BiometricVoiceVisualizer from '@/components/BiometricVoiceVisualizer';
import SafeHavenRadar from '@/components/SafeHavenRadar';
import AISafetyPlanModal from '@/components/AISafetyPlanModal';
import EvidenceVaultModal from '@/components/EvidenceVaultModal';
import NotificationCenter from '@/components/NotificationCenter';

const tabs = [
  { key: 'voice', icon: Mic, label: 'aiVoice' },
  { key: 'chat', icon: MessageCircle, label: 'aiChat' },
  { key: 'help', icon: AlertTriangle, label: 'immediateHelp' },
  { key: 'cases', icon: ClipboardList, label: 'caseStatus' },
  { key: 'follow', icon: Bell, label: 'followups' },
  { key: 'settings', icon: SettingsIcon, label: 'settings' },
];

const SAFE_WORDS = ['pineapple', 'red', 'mayday', 'help me now', 'emergency red'];

export default function VictimHome() {
  const { user, logout, lang, setLang } = useAuth();
  const [tab, setTab] = useState('voice');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [caseId, setCaseId] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [thinkingHint, setThinkingHint] = useState('Nivara is listening carefully...');
  const [svi, setSvi] = useState({ score: 0, level: 'Low' });
  const [cases, setCases] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [showSOS, setShowSOS] = useState(false);
  const [sosMsg, setSosMsg] = useState('');
  const [orbState, setOrbState] = useState('idle'); // idle | listening | thinking | speaking
  const [showVoiceConsentModal, setShowVoiceConsentModal] = useState(false);
  const [voiceConsentAnswered, setVoiceConsentAnswered] = useState(false);
  
  // Futuristic States & Modals
  const [suggestedReplies, setSuggestedReplies] = useState([
    "I need advice on safety",
    "Someone is following me",
    "How can I report this discreetly?"
  ]);
  const [isDisguised, setIsDisguised] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showRadarModal, setShowRadarModal] = useState(false);
  const [showSafetyPlanModal, setShowSafetyPlanModal] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [recordingInline, setRecordingInline] = useState(false);
  const [langBanner, setLangBanner] = useState(null);
  const [detectedLang, setDetectedLang] = useState('en');
  const [counsellorOnline, setCounsellorOnline] = useState(null);

  const mediaRef = useRef(null);
  const inlineMediaRef = useRef(null);
  const chunksRef = useRef([]);
  const inlineChunksRef = useRef([]);
  const audioRef = useRef(new Audio());
  const scrollRef = useRef(null);

  useEffect(() => {
    // Check existing voice consent
    api.get('/consent/voice').then((r) => {
      if (r.data && r.data.granted !== undefined) {
        setVoiceConsentAnswered(true);
      }
    }).catch(() => {});

    // Trigger Voice Onboarding on first visit
    const onboardingPlayed = localStorage.getItem('nivara_voice_onboarding_played');
    if (!onboardingPlayed) {
      triggerVoiceOnboarding();
    }
  }, []);

  const triggerVoiceOnboarding = async () => {
    try {
      toast.info("Nivara is initializing warm voice greeting...", { duration: 3000 });
      setOrbState('thinking');
      const { data } = await api.get('/voice/onboarding');
      if (data.audio_b64) {
        const audioBytes = Uint8Array.from(atob(data.audio_b64), (c) => c.charCodeAt(0));
        const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
        audioRef.current.src = URL.createObjectURL(audioBlob);
        setOrbState('speaking');
        audioRef.current.onended = () => {
          setOrbState('idle');
          localStorage.setItem('nivara_voice_onboarding_played', 'true');
        };
        audioRef.current.play().catch(() => setOrbState('idle'));
      }
    } catch (e) {
      setOrbState('idle');
    }
  };

  useEffect(() => {
    const ws = connectWS((msg) => {
      if (msg.type === 'counsellor_assigned') {
        toast.success(`Counsellor ${msg.counsellor_name} joined your safety circle`);
        setCounsellorOnline(msg.counsellor_name);
      }
      if (msg.type === 'counsellor_message') {
        toast.info(`Message from Counselor ${msg.counsellor_name}`);
        setMessages((m) => [...m, {
          role: 'counsellor',
          content: msg.message,
          sender: msg.counsellor_name,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
      }
      if (msg.type === 'status_change') toast.info(`Case status: ${msg.status}`);
      if (msg.type === 'followup_scheduled') { toast.info('A follow-up has been scheduled'); loadFollowups(); }
      if (msg.type === 'case_update') toast.info(`Officer action: ${msg.action}`);
    });
    return () => ws && ws.close();
  }, []);

  useEffect(() => { loadCases(); }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, thinking]);

  const loadCases = async () => {
    try {
      const { data } = await api.get('/cases/mine');
      setCases(data);
      const active = data.find((c) => c.status !== 'resolved');
      if (active) {
        setCaseId(active.id);
        if (active.counsellor_name) setCounsellorOnline(active.counsellor_name);
      }
      const allFollowups = [];
      for (const c of data.slice(0, 5)) {
        try {
          const d = await api.get(`/cases/${c.id}`);
          d.data.followups.forEach((f) => allFollowups.push({ ...f, case_title: c.title }));
        } catch {}
      }
      setFollowups(allFollowups);
    } catch (e) { /* silent */ }
  };
  const loadFollowups = loadCases;

  // Silent Safe Word SOS Trigger
  const checkSafeWord = (text) => {
    const lower = text.toLowerCase();
    const found = SAFE_WORDS.find((word) => lower.includes(word));
    if (found) {
      toast.warning('Silent Security Alert Triggered');
      triggerSilentSOS();
    }
  };

  const triggerSilentSOS = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.post('/sos', {
              case_id: caseId,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              location_label: 'Silent Safe-Word Triggered',
              message: 'AUTOMATIC SAFE WORD ALERT DETECTED IN CHAT',
            });
            toast.success('Emergency dispatch alerted silently.');
            loadCases();
          } catch {}
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }
  };

  const sendText = async (textToSend = null) => {
    const msg = (textToSend || input).trim();
    if (!msg || thinking) return;

    checkSafeWord(msg);

    const userMsgObj = { role: 'user', content: msg, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages((m) => [...m, userMsgObj]);
    if (!textToSend) setInput('');

    setThinking(true);
    setOrbState('thinking');
    
    // Dynamic Thinking Hints
    const hints = [
      "Nivara is analyzing risk factors...",
      "Evaluating language tone...",
      "Synthesizing safe response...",
      "Scanning context indicators..."
    ];
    setThinkingHint(hints[Math.floor(Math.random() * hints.length)]);

    try {
      const { data } = await api.post('/chat', { case_id: caseId, message: msg });
      setCaseId(data.case_id);
      setSvi({ score: data.svi_score, level: data.risk_level });

      if (data.language && data.language !== detectedLang) {
        setDetectedLang(data.language);
        const langNames = { en: 'English', ta: 'Tamil (தமிழ்)', hi: 'Hindi (हिंदी)', tanglish: 'Tanglish', hinglish: 'Hinglish' };
        setLangBanner(`Nivara adaptively switched to ${langNames[data.language] || data.language}`);
        setTimeout(() => setLangBanner(null), 5000);
      }

      if (data.suggested_replies && data.suggested_replies.length > 0) {
        setSuggestedReplies(data.suggested_replies);
      }

      const botMsgObj = { 
        role: 'assistant', 
        content: data.reply, 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        svi_score: data.svi_score,
        risk_level: data.risk_level
      };
      setMessages((m) => [...m, botMsgObj]);
      speak(data.reply);
    } catch (e) {
      toast.error('AI service temporarily unavailable');
      setOrbState('idle');
    } finally { 
      setThinking(false); 
    }
  };

  const speak = async (text) => {
    try {
      setOrbState('speaking');
      const r = await api.post('/tts', { text }, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      audioRef.current.src = url;
      audioRef.current.onended = () => setOrbState('idle');
      audioRef.current.play().catch(() => setOrbState('idle'));
    } catch { setOrbState('idle'); }
  };

  const handleAllowVoiceConsent = async () => {
    try {
      await api.post('/consent', { kind: 'voice', granted: true });
      setVoiceConsentAnswered(true);
      setShowVoiceConsentModal(false);
      toast.success('Voice analysis consent saved');
      startRecordingCore();
    } catch {
      setShowVoiceConsentModal(false);
      startRecordingCore();
    }
  };

  const handleDenyVoiceConsent = async () => {
    try {
      await api.post('/consent', { kind: 'voice', granted: false });
      setVoiceConsentAnswered(true);
      setShowVoiceConsentModal(false);
      toast.info('Voice acoustic analysis disabled. Proceeding with text STT only.');
      startRecordingCore();
    } catch {
      setShowVoiceConsentModal(false);
      startRecordingCore();
    }
  };

  const startRecording = async () => {
    if (!voiceConsentAnswered) {
      setShowVoiceConsentModal(true);
      return;
    }
    startRecordingCore();
  };

  const startRecordingCore = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setOrbState('thinking'); setThinking(true);
        const fd = new FormData();
        fd.append('audio', blob, 'voice.webm');
        if (caseId) fd.append('case_id', caseId);
        try {
          const { data } = await api.post('/voice', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          setCaseId(data.case_id);
          setSvi({ score: data.svi_score, level: data.risk_level });
          setMessages((m) => [...m, { role: 'user', content: data.transcript }, { role: 'assistant', content: data.reply }]);
          if (data.audio_b64) {
            const audioBytes = Uint8Array.from(atob(data.audio_b64), (c) => c.charCodeAt(0));
            const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
            audioRef.current.src = URL.createObjectURL(audioBlob);
            setOrbState('speaking');
            audioRef.current.onended = () => setOrbState('idle');
            audioRef.current.play().catch(() => setOrbState('idle'));
          } else { setOrbState('idle'); }
        } catch (e) {
          toast.error('Voice processing failed'); setOrbState('idle');
        } finally { setThinking(false); }
      };
      mediaRef.current = rec;
      rec.start(); setOrbState('listening');
    } catch (e) {
      toast.error('Microphone permission needed');
    }
  };

  const stopRecording = () => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  };

  // Inline Voice-to-Text in Chat Input Bar
  const startInlineRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      inlineChunksRef.current = [];
      rec.ondataavailable = (e) => inlineChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(inlineChunksRef.current, { type: 'audio/webm' });
        setRecordingInline(false);
        const fd = new FormData();
        fd.append('audio', blob, 'voice.webm');
        if (caseId) fd.append('case_id', caseId);
        try {
          toast.info('Transcribing voice...');
          const { data } = await api.post('/voice', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          if (data.transcript) {
            setInput(data.transcript);
            toast.success('Voice transcribed into input');
          }
        } catch {
          toast.error('Failed to transcribe voice');
        }
      };
      inlineMediaRef.current = rec;
      rec.start();
      setRecordingInline(true);
    } catch {
      toast.error('Microphone permission needed');
    }
  };

  const stopInlineRecording = () => {
    if (inlineMediaRef.current && inlineMediaRef.current.state !== 'inactive') {
      inlineMediaRef.current.stop();
    }
  };

  const triggerSOS = () => setShowSOS(true);
  const confirmSOS = () => {
    if (!navigator.geolocation) return toast.error('Location unavailable');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { data } = await api.post('/sos', {
          case_id: caseId, latitude: pos.coords.latitude, longitude: pos.coords.longitude,
          location_label: 'Current location', message: sosMsg,
        });
        if (data.nearest_officer && data.nearest_officer.name) {
          toast.success(`🚨 SOS Dispatched! Routed to nearest patrol: ${data.nearest_officer.name} (${data.nearest_officer.duty_area}, ${data.nearest_officer.distance_km} km away). Help is en route!`, { duration: 8000 });
        } else {
          toast.success('Emergency alert sent. Help is on the way.');
        }
        setShowSOS(false); setSosMsg(''); loadCases();
      } catch { toast.error('Could not send SOS'); }
    }, () => toast.error('Location permission denied. Enable it and try again.'), { enableHighAccuracy: true });
  };

  // Export Evidence Report
  const handleExportEvidence = () => {
    const textContent = `NIVARA CASE EVIDENCE REPORT\n` +
      `Date Generated: ${new Date().toLocaleString()}\n` +
      `Case ID: ${caseId || 'N/A'}\n` +
      `Victim Name: ${user?.name || 'Anonymous'}\n` +
      `Current Safety Vulnerability Index (SVI): ${svi.score} (${svi.level})\n\n` +
      `=== TRANSCRIPT TIMELINE ===\n\n` +
      messages.map((m, i) => `[${m.timestamp || 'N/A'}] ${m.role === 'user' ? 'VICTIM' : m.role === 'counsellor' ? `COUNSELLOR (${m.sender})` : 'NIVARA AI'}:\n${m.content}\n`).join('\n-------------------------\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Nivara_Evidence_Report_${caseId || 'case'}.txt`;
    link.click();
    toast.success('Evidence timeline exported successfully');
  };

  // Disguise View
  if (isDisguised) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 flex flex-col items-center justify-center relative">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex justify-between items-center border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2 font-bold text-slate-300 text-sm">
              <FileText className="w-4 h-4 text-emerald-400" /> Daily Notes & Math Helper
            </div>
            <button 
              onClick={() => setIsDisguised(false)} 
              className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-slate-400 hover:text-white transition"
              title="Unlock Safety App"
            >
              <Lock className="w-3 h-3 text-emerald-400" /> Restore Mode
            </button>
          </div>
          
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick Calculation & Shopping List</h3>
            <div className="bg-slate-950 p-4 rounded-xl text-right font-mono text-2xl tracking-wider text-emerald-400 border border-slate-800">
              1,240.00
            </div>
            <div className="grid grid-cols-4 gap-2 text-center font-bold text-slate-300">
              {['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'].map((btn, i) => (
                <div key={i} className="p-3 bg-slate-800/60 rounded-lg hover:bg-slate-800 cursor-pointer">{btn}</div>
              ))}
            </div>
          </div>

          <div className="pt-2 text-xs text-slate-500 text-center">
            Press "Restore Mode" to return to active view.
          </div>
        </div>
      </div>
    );
  }

  // Calculate SVI Color Gradient for Live Pulse Bar
  const getSviGradient = (score) => {
    if (score >= 75) return 'from-red-600 via-rose-500 to-red-600';
    if (score >= 50) return 'from-orange-500 via-amber-500 to-red-500';
    if (score >= 25) return 'from-yellow-500 via-emerald-400 to-amber-500';
    return 'from-emerald-500 via-teal-400 to-cyan-500';
  };

  return (
    <div className="min-h-screen font-victim text-slate-100 relative overflow-hidden"
         style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1E293B 60%, #1a1032 100%)' }}>
      <div className="absolute inset-0 pointer-events-none opacity-40"
           style={{ background: 'radial-gradient(circle at 20% 30%, rgba(196,181,253,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(138,154,91,0.3), transparent 45%)' }} />

      {/* Feature 1: Live SVI Pulse Meter Bar (Top) */}
      <div className="relative z-20 bg-slate-950/85 backdrop-blur border-b border-slate-800/80 px-4 sm:px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${svi.score >= 50 ? 'text-red-400 animate-pulse' : 'text-emerald-400'}`} />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 hidden sm:inline">Live SVI Pulse</span>
          </div>
          
          <div className="w-28 sm:w-44 bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800 relative">
            <div 
              className={`h-full rounded-full bg-gradient-to-r ${getSviGradient(svi.score)} transition-all duration-500`} 
              style={{ width: `${Math.max(8, svi.score)}%` }}
            />
            {svi.score >= 50 && (
              <div className="absolute inset-0 bg-red-500/20 animate-ping rounded-full" />
            )}
          </div>
          <span className="text-xs font-extrabold text-slate-200">{svi.score}/100</span>
        </div>

        {/* Action Toolbox: Radar, Safety Plan, Evidence Vault, Disguise */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Safe Haven Radar */}
          <button 
            onClick={() => setShowRadarModal(true)}
            className="px-2.5 py-1 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-500/40 text-teal-300 text-xs font-semibold flex items-center gap-1 transition"
            title="Safe Haven Radar Map"
          >
            <Radio className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
            <span className="hidden md:inline">Safe Havens</span>
          </button>

          {/* AI Safety Action Plan */}
          <button 
            onClick={() => setShowSafetyPlanModal(true)}
            className="px-2.5 py-1 rounded-lg bg-violet-950/80 hover:bg-violet-900 border border-violet-500/40 text-violet-300 text-xs font-semibold flex items-center gap-1 transition"
            title="AI Safety Action Strategy"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
            <span className="hidden md:inline">Safety Plan</span>
          </button>

          {/* Stealth Evidence Vault */}
          <button 
            onClick={() => setShowEvidenceModal(true)}
            className="px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center gap-1 transition"
            title="Evidence Vault"
          >
            <Camera className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Vault</span>
          </button>

          {/* Disguise Screen */}
          <button 
            onClick={() => setIsDisguised(true)}
            className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 border border-slate-700 transition"
            title="Disguise Screen Privacy"
          >
            <EyeOff className="w-3.5 h-3.5 text-violet-400" />
            <span className="hidden lg:inline">Disguise</span>
          </button>
        </div>
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Hi, <span className="text-white font-semibold">{user?.name}</span></span>
          {counsellorOnline && (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> Counselor Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SVIBadge score={svi.score} level={svi.level} />
          <NotificationCenter />
          <select value={lang} onChange={(e) => setLang(e.target.value)} data-testid="victim-lang"
                  className="bg-slate-900/60 border border-slate-700 rounded-lg px-2 py-1 text-xs">
            <option value="en">EN</option><option value="ta">TA</option><option value="hi">HI</option>
          </select>
          <button onClick={logout} data-testid="victim-logout" className="p-2 rounded-lg hover:bg-slate-800/60"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Language Switch Banner */}
      {langBanner && (
        <div className="relative z-20 max-w-xl mx-auto mb-2 px-4">
          <div className="bg-violet-600/90 text-white text-xs font-semibold px-4 py-2 rounded-xl backdrop-blur border border-violet-400/40 shadow-xl flex items-center justify-between animate-bounce">
            <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> {langBanner}</span>
            <button onClick={() => setLangBanner(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Main content by tab */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 pb-32">
        {tab === 'voice' && (
          <div className="flex flex-col items-center justify-center pt-4 space-y-6">
            <div className={`victim-orb ${orbState !== 'idle' ? orbState : ''} w-52 h-52 rounded-full`} data-testid="victim-orb" />
            
            <div className="text-center">
              <div className="text-xs uppercase tracking-widest text-violet-300 mb-1">
                {orbState === 'listening' ? t(lang, 'listening')
                  : orbState === 'thinking' ? t(lang, 'thinking')
                  : orbState === 'speaking' ? t(lang, 'speaking')
                  : t(lang, 'tapToSpeak')}
              </div>
            </div>

            <button
              onMouseDown={startRecording} onMouseUp={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              data-testid="voice-record-btn"
              className={`w-16 h-16 rounded-full flex items-center justify-center ${orbState === 'listening' ? 'bg-red-500' : 'bg-violet-400'} text-slate-900 shadow-2xl hover:scale-105 transition`}
            >
              {orbState === 'listening' ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
            </button>

            {/* Biometric Voice Stress Spectrum Visualizer */}
            <div className="w-full max-w-lg">
              <BiometricVoiceVisualizer
                isRecording={orbState === 'listening'}
                isPlaying={orbState === 'speaking'}
                stressScore={svi.score}
              />
            </div>

            {messages.length > 0 && (
              <div className="w-full max-h-56 overflow-y-auto space-y-2" data-testid="voice-transcript">
                {messages.slice(-4).map((m, i) => (
                  <div key={i} className={`p-3 rounded-2xl ${m.role === 'user' ? 'bg-violet-500/20 ml-12' : 'bg-slate-800/60 mr-12'}`}>
                    <div className="text-xs text-slate-400 mb-1">{m.role === 'user' ? 'You' : m.role === 'counsellor' ? `Counselor ${m.sender}` : 'Nivara'}</div>
                    <div className="text-sm">{m.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="pt-2 flex flex-col h-[calc(100vh-250px)] relative" data-testid="victim-chat">
            
            {/* Panic Shortcut inside Chat */}
            {svi.score >= 40 && (
              <div className="mb-3 p-3 bg-red-950/80 border border-red-500/40 rounded-2xl flex items-center justify-between text-red-200 text-xs backdrop-blur shadow-lg animate-pulse">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-400" />
                  <span>Risk detected (SVI: {svi.score}). Emergency support available instantly.</span>
                </div>
                <button 
                  onClick={triggerSOS}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow"
                >
                  🚨 Trigger SOS Now
                </button>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1">
              {messages.length === 0 && (
                <div className="text-center text-slate-400 py-12">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-40 text-violet-400" />
                  <p className="text-slate-300 font-medium">Whatever you're carrying, share it here. I'm listening with care.</p>
                  <p className="text-xs text-slate-500 mt-2">💡 Tip: Type safe-word <span className="text-violet-300 font-mono">"pineapple"</span> or <span className="text-violet-300 font-mono">"red"</span> for silent SOS dispatch.</p>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`p-4 rounded-2xl max-w-[85%] ${
                  m.role === 'user' 
                    ? 'bg-violet-600/30 border border-violet-500/30 ml-auto' 
                    : m.role === 'counsellor'
                    ? 'bg-emerald-950/80 border border-emerald-500/50 backdrop-blur'
                    : 'bg-slate-900/80 border border-slate-800 backdrop-blur'
                }`}>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span className={`font-semibold ${m.role === 'counsellor' ? 'text-emerald-300 flex items-center gap-1' : ''}`}>
                      {m.role === 'user' ? 'You' : m.role === 'counsellor' ? `🛡️ Counselor ${m.sender}` : 'Nivara AI'}
                    </span>
                    {m.timestamp && <span className="text-[10px] text-slate-500">{m.timestamp}</span>}
                  </div>
                  <div className="text-sm leading-relaxed text-slate-100">{m.content}</div>
                  
                  {m.role === 'assistant' && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                      <button onClick={() => speak(m.content)} className="text-xs text-violet-300 hover:text-violet-200 flex items-center gap-1">
                        <Volume2 className="w-3.5 h-3.5" /> Voice Reply
                      </button>
                      {m.svi_score !== undefined && (
                        <span className="text-[10px] font-mono text-slate-400">SVI Score: {m.svi_score}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* AI Thinking Animation with Emotion Hint */}
              {thinking && (
                <div className="p-4 rounded-2xl max-w-[75%] bg-slate-900/90 border border-violet-500/30 flex items-center gap-3 shadow-xl">
                  <Sparkles className="w-4 h-4 text-violet-400 animate-spin" />
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-violet-300">{thinkingHint}</div>
                    <div className="flex gap-1.5 items-center">
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-ping" />
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-ping delay-150" />
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-ping delay-300" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Suggested Quick Reply Chips */}
            {suggestedReplies.length > 0 && !thinking && (
              <div className="mb-2 flex flex-wrap gap-2">
                {suggestedReplies.map((replyText, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendText(replyText)}
                    className="text-xs bg-slate-900/90 hover:bg-violet-950 text-slate-300 hover:text-violet-200 border border-slate-700/80 hover:border-violet-500/60 px-3 py-1.5 rounded-full transition shadow-sm"
                  >
                    ✨ {replyText}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Input Bar with Inline Voice Mic */}
            <div className="flex gap-2 items-center bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-2 shadow-2xl">
              <button
                onMouseDown={startInlineRecording}
                onMouseUp={stopInlineRecording}
                onTouchStart={startInlineRecording}
                onTouchEnd={stopInlineRecording}
                className={`p-2.5 rounded-xl text-slate-300 hover:bg-slate-800 transition ${recordingInline ? 'bg-red-500 text-white animate-pulse' : 'hover:text-violet-300'}`}
                title="Hold to speak directly into chat"
              >
                {recordingInline ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendText()} data-testid="chat-input"
                placeholder={recordingInline ? "Listening to your voice..." : t(lang, 'typeMessage')}
                className="flex-1 bg-transparent px-3 py-2 outline-none text-sm text-slate-100 placeholder-slate-500" />
              
              <button onClick={() => sendText()} disabled={thinking || !input.trim()} data-testid="chat-send"
                className="p-2.5 rounded-xl bg-violet-400 text-slate-900 hover:bg-violet-300 disabled:opacity-30 transition">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {tab === 'help' && (
          <div className="flex flex-col items-center pt-8">
            <div className="max-w-md text-center mb-8">
              <AlertTriangle className="w-14 h-14 mx-auto text-red-400 mb-4 animate-bounce" />
              <p className="text-slate-300 leading-relaxed">
                Pressing the button below will send your <b>live location</b>, case history, and current risk
                assessment to the nearest officer on duty. You are safe. Help is close.
              </p>
            </div>
            <button onClick={triggerSOS} data-testid="sos-btn"
              className="px-10 py-6 rounded-full text-lg font-black tracking-wide bg-red-500 hover:bg-red-400 text-white shadow-2xl shadow-red-500/40 animate-pulse">
              🚨 {t(lang, 'needHelpNow')}
            </button>
          </div>
        )}

        {tab === 'cases' && (
          <div className="pt-4 space-y-3" data-testid="case-status-list">
            <h2 className="text-2xl font-extrabold mb-4">{t(lang, 'caseStatus')}</h2>
            {cases.length === 0 && <p className="text-slate-400">{t(lang, 'noCases')}</p>}
            {cases.map((c) => (
              <div key={c.id} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold">{c.title}</div>
                    <div className="text-xs text-slate-400 mt-1">Status: <span className="text-violet-300">{c.status}</span> · Priority: {c.priority}</div>
                    {c.counsellor_name && <div className="text-xs text-emerald-300 mt-1">Counsellor: {c.counsellor_name}</div>}
                  </div>
                  <SVIBadge score={c.svi_score} level={c.risk_level} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'follow' && (
          <div className="pt-4 space-y-3" data-testid="followups-list">
            <h2 className="text-2xl font-extrabold mb-4">{t(lang, 'followups')}</h2>
            {followups.length === 0 && <p className="text-slate-400">No follow-ups scheduled yet.</p>}
            {followups.map((f) => (
              <div key={f.id} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
                <div className="text-xs text-violet-300">{new Date(f.scheduled_at).toLocaleString()}</div>
                <div className="font-semibold mt-1">{f.case_title}</div>
                {f.notes && <div className="text-sm text-slate-400 mt-1">{f.notes}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 'settings' && (
          <div className="pt-4 max-w-lg" data-testid="victim-settings">
            <h2 className="text-2xl font-extrabold mb-4">{t(lang, 'settings')}</h2>
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div>
                <label className="text-xs text-slate-400">{t(lang, 'language')}</label>
                <select value={lang} onChange={(e) => setLang(e.target.value)}
                  className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
                  <option value="en">{t(lang, 'en')}</option>
                  <option value="ta">{t(lang, 'ta')}</option>
                  <option value="hi">{t(lang, 'hi')}</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <label className="text-xs text-slate-400">Silent Safe Words</label>
                <p className="text-xs text-slate-500 mt-1">Typing any of these words in chat sends an immediate background alert: <span className="font-mono text-violet-300">pineapple, red, mayday</span></p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-slate-900/80 backdrop-blur-xl border border-slate-700 rounded-full px-2 py-2 flex gap-1 shadow-2xl">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`tab-${tb.key}`}
            className={`px-3 py-2 rounded-full flex items-center gap-1.5 text-xs font-semibold ${tab === tb.key ? 'bg-violet-400 text-slate-900' : 'text-slate-300 hover:bg-slate-800'}`}
            style={{ transition: 'background-color 200ms, color 200ms' }}>
            <tb.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t(lang, tb.label)}</span>
          </button>
        ))}
      </div>

      {/* SOS Confirm Modal */}
      {showSOS && (
        <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="sos-modal">
          <div className="max-w-md w-full bg-slate-900 border border-red-500/50 rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2 text-red-400 font-bold"><AlertTriangle className="w-5 h-5" /> Confirm Emergency</div>
              <button onClick={() => setShowSOS(false)}><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-slate-300 mb-4">{t(lang, 'confirmSOS')}</p>
            <textarea value={sosMsg} onChange={(e) => setSosMsg(e.target.value)} data-testid="sos-message"
              placeholder="Optional: describe what's happening" rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm mb-4 outline-none focus:border-red-400 text-slate-100" />
            <div className="flex gap-3">
              <button onClick={() => setShowSOS(false)} className="flex-1 py-3 rounded-xl border border-slate-700 hover:bg-slate-800">{t(lang, 'cancel')}</button>
              <button onClick={confirmSOS} data-testid="sos-confirm"
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold shadow-lg shadow-red-500/30">{t(lang, 'yesSendHelp')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Safe Haven Radar Modal */}
      {showRadarModal && (
        <SafeHavenRadar onClose={() => setShowRadarModal(false)} />
      )}

      {/* AI Safety Plan Modal */}
      {showSafetyPlanModal && (
        <AISafetyPlanModal caseId={caseId} onClose={() => setShowSafetyPlanModal(false)} />
      )}

      {/* Stealth Evidence Vault Modal */}
      {showEvidenceModal && (
        <EvidenceVaultModal caseId={caseId} onClose={() => setShowEvidenceModal(false)} />
      )}

      {/* Export Timeline Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                <FileText className="w-5 h-5" /> Evidence Report Preview
              </div>
              <button onClick={() => setShowExportModal(false)}><X className="w-5 h-5 text-slate-400 hover:text-white" /></button>
            </div>

            <div className="my-4 flex-1 overflow-y-auto space-y-3 font-mono text-xs bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-300">
              <div><b>CASE ID:</b> {caseId || 'Active Case'}</div>
              <div><b>VICTIM:</b> {user?.name}</div>
              <div><b>CURRENT SVI RISK SCORE:</b> {svi.score} / 100 ({svi.level})</div>
              <div className="pt-2 border-t border-slate-800 font-sans text-xs">
                <b>TOTAL MESSAGES:</b> {messages.length}
              </div>
              <div className="space-y-2 pt-2">
                {messages.map((m, i) => (
                  <div key={i} className="p-2 bg-slate-900/90 rounded border border-slate-800">
                    <span className="text-violet-400 font-bold">[{m.role.toUpperCase()}]</span> {m.content}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowExportModal(false)} className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm hover:bg-slate-800">Close</button>
              <button onClick={handleExportEvidence} className="flex-1 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow">
                <Download className="w-4 h-4" /> Download Text Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Consent Modal */}
      {showVoiceConsentModal && (
        <VoiceConsentModal
          onAllow={handleAllowVoiceConsent}
          onDeny={handleDenyVoiceConsent}
          onClose={() => setShowVoiceConsentModal(false)}
        />
      )}
    </div>
  );
}
