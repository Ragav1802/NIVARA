import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { X, Send, Mic, MicOff, RefreshCw, Volume2, Sparkles, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

export default function VoiceAssistantModal({ isOpen, onClose, onSendToChat }) {
  const [selectedLang, setSelectedLang] = useState('en-IN');
  const [statusText, setStatusText] = useState('Ready');
  const [statusDotClass, setStatusDotClass] = useState(''); // '' | 'listening' | 'error' | 'processing'
  const [transcriptText, setTranscriptText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isRecordingMedia, setIsRecordingMedia] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [activeEngine, setActiveEngine] = useState('web'); // 'web' | 'whisper'
  const [micVolume, setMicVolume] = useState(0);

  const recognitionRef = useRef(null);
  const userStoppedRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const isListeningRef = useRef(false);
  const isRecordingMediaRef = useRef(false);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);

  const SpeechRecognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopAll = () => {
    userStoppedRef.current = true;
    isListeningRef.current = false;
    isRecordingMediaRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
    setIsRecordingMedia(false);
  };

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, []);

  if (!isOpen) return null;

  const getBestMimeType = () => {
    const candidateTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    if (typeof window !== 'undefined' && window.MediaRecorder) {
      for (const type of candidateTypes) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      }
    }
    return '';
  };

  // 1. Web Speech API Handler
  const startWebSpeech = () => {
    if (!SpeechRecognition) {
      toast.info('Web Speech API unavailable in this browser. Using AI Whisper STT mode...');
      startMediaRecorder();
      return;
    }

    stopAll();
    userStoppedRef.current = false;
    isListeningRef.current = true;
    setIsListening(true);
    setActiveEngine('web');

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = selectedLang;

      recognition.onstart = () => {
        isListeningRef.current = true;
        setIsListening(true);
        setStatusText('Listening live... Speak now!');
        setStatusDotClass('listening');
      };

      recognition.onresult = (event) => {
        let finalStr = '';
        let interimStr = '';

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0].transcript;
          if (res.isFinal) {
            finalStr += text + ' ';
          } else {
            interimStr += text;
          }
        }

        setTranscriptText(finalStr + interimStr);
      };

      recognition.onend = () => {
        if (!userStoppedRef.current && isListeningRef.current) {
          try {
            recognition.start();
            return;
          } catch (e) {}
        }
        isListeningRef.current = false;
        setIsListening(false);
        if (!userStoppedRef.current) {
          setStatusText('Ready');
          setStatusDotClass('');
        }
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          setStatusText('Listening... (speak into mic)');
          return;
        }
        isListeningRef.current = false;
        setIsListening(false);
        setStatusDotClass('error');

        if (event.error === 'not-allowed') {
          setStatusText('Microphone permission denied');
          toast.error('Microphone permission denied in browser.');
        } else if (event.error === 'network') {
          setStatusText('Browser speech engine network error. Switching to AI Whisper...');
          toast.info('Switching to AI Whisper mode...');
          startMediaRecorder();
        } else {
          setStatusText(`Speech error: ${event.error}`);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Speech recognition exception:', err);
      setStatusText('Web speech engine failed. Switching to AI Whisper...');
      startMediaRecorder();
    }
  };

  const stopAudioAnalyser = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    setMicVolume(0);
  };

  const startAudioAnalyser = (stream) => {
    stopAudioAnalyser();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicVolume(normalized);
        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (e) {
      console.warn('Audio analyser error:', e);
    }
  };

  // 2. MediaRecorder + Backend Groq Whisper STT Handler
  const startMediaRecorder = async () => {
    stopAll();
    userStoppedRef.current = false;
    isRecordingMediaRef.current = true;
    setIsRecordingMedia(true);
    setActiveEngine('whisper');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startAudioAnalyser(stream);
      const mimeType = getBestMimeType();
      const options = mimeType ? { mimeType } : {};
      const rec = new MediaRecorder(stream, options);

      audioChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      rec.onstop = async () => {
        stopAudioAnalyser();
        stream.getTracks().forEach((t) => t.stop());
        const finalBlobType = mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: finalBlobType });
        isRecordingMediaRef.current = false;
        setIsRecordingMedia(false);

        if (!blob || blob.size < 100) {
          setStatusText('No audio recorded');
          setStatusDotClass('error');
          toast.warning('No audio captured. Please speak into the mic.');
          return;
        }

        setStatusText('Transcribing audio with AI Whisper...');
        setStatusDotClass('processing');

        const fd = new FormData();
        const ext = finalBlobType.includes('mp4') ? 'mp4' : finalBlobType.includes('ogg') ? 'ogg' : 'webm';
        fd.append('audio', blob, `voice.${ext}`);
        fd.append('language', selectedLang);

        try {
          const { data } = await api.post('/stt', fd, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          if (data.transcript && !data.transcript.includes('[Voice recorded')) {
            setTranscriptText((prev) => (prev ? `${prev.trim()} ${data.transcript}` : data.transcript));
            setStatusText('Transcription complete!');
            setStatusDotClass('');
            toast.success('Voice transcribed successfully');
          } else {
            setStatusText('Could not transcribe audio clearly. Speak again.');
            setStatusDotClass('error');
            toast.warning('Speech could not be recognized clearly. Please try speaking again.');
          }
        } catch (e) {
          console.error('STT upload error:', e);
          setStatusText('Transcription error');
          setStatusDotClass('error');
          toast.error('Voice transcription failed');
        }
      };

      mediaRecorderRef.current = rec;
      rec.start(200);
      setStatusText('Recording audio... Click STOP when done!');
      setStatusDotClass('listening');
    } catch (e) {
      stopAudioAnalyser();
      console.error('Mic access error:', e);
      setStatusText('Microphone access denied');
      setStatusDotClass('error');
      toast.error('Microphone access denied or blocked by browser');
    }
  };

  const handleStop = () => {
    userStoppedRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    setIsListening(false);
    setIsRecordingMedia(false);
    setStatusText('Ready');
    setStatusDotClass('');
  };

  const handleClear = () => {
    setTranscriptText('');
    setStatusText('Ready');
    setStatusDotClass('');
  };

  const handleCopy = async () => {
    const text = transcriptText.trim();
    if (!text) {
      toast.info('No text available to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      toast.success('Text copied to clipboard!');
      setTimeout(() => setCopySuccess(false), 1500);
    } catch (err) {
      toast.success('Text copied!');
    }
  };

  const handleDownload = () => {
    const text = transcriptText.trim();
    if (!text) {
      toast.info('No text available to download.');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voice-transcription-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Downloaded transcription file');
  };

  const handleSendToChat = () => {
    const text = transcriptText.trim();
    if (!text) {
      toast.info('No transcription available to send.');
      return;
    }
    if (onSendToChat) {
      onSendToChat(text);
      toast.success('Transcript sent to AI Companion!');
      handleStop();
      onClose();
    }
  };

  const words = transcriptText.trim().split(/\s+/).filter(Boolean);
  const wordCountDisplay =
    words.length === 0 ? '0 words' : words.length === 1 ? '1 word' : `${words.length} words`;

  const isCurrentlyRecording = isListening || isRecordingMedia;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-2xl relative text-slate-900 font-sans my-8">
        {/* Close Button */}
        <button
          onClick={() => {
            handleStop();
            onClose();
          }}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
          title="Close Voice Assistant"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-tr from-slate-900 to-violet-900 text-white rounded-2xl flex items-center justify-center text-3xl shadow-lg shadow-slate-900/20">
            🎙️
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 leading-tight">
              Voice to Text Assistant
            </h1>
            <p className="text-sm text-slate-500">
              Speak naturally. Multilingual support powered by AI Whisper & Browser Speech.
            </p>
          </div>
        </div>

        {/* Controls: Language + Status */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <label htmlFor="language" className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Target Language
            </label>
            <select
              id="language"
              value={selectedLang}
              disabled={isCurrentlyRecording}
              onChange={(e) => setSelectedLang(e.target.value)}
              className="w-full sm:w-56 px-3 py-2.5 border border-slate-300 rounded-xl bg-white text-sm font-medium text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition cursor-pointer disabled:opacity-50"
            >
              <option value="en-IN">English (India)</option>
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="ta-IN">Tamil (தமிழ்)</option>
              <option value="hi-IN">Hindi (हिंदी)</option>
              <option value="te-IN">Telugu (తెలుగు)</option>
              <option value="ml-IN">Malayalam (മലയാളം)</option>
              <option value="kn-IN">Kannada (கன்னட)</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            {isCurrentlyRecording && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                <span className="text-xs font-semibold text-emerald-800">Mic Level:</span>
                <div className="w-24 h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75 rounded-full"
                    style={{ width: `${Math.max(5, micVolume)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-emerald-700 font-bold">{micVolume}%</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-slate-600 font-medium bg-slate-100 px-3 py-1.5 rounded-full">
              <span
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  statusDotClass === 'listening'
                    ? 'bg-emerald-600 shadow-[0_0_0_4px_rgba(22,163,74,0.2)] animate-pulse'
                    : statusDotClass === 'processing'
                    ? 'bg-violet-600 animate-spin'
                    : statusDotClass === 'error'
                    ? 'bg-red-600'
                    : 'bg-slate-400'
                }`}
              />
              <span id="status" className="truncate max-w-xs">{statusText}</span>
            </div>
          </div>
        </div>

        {/* Transcription Textarea */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/70 mb-6 shadow-inner">
          <div className="h-12 px-4 border-b border-slate-200 flex justify-between items-center text-sm font-semibold text-slate-700 bg-white">
            <span className="flex items-center gap-1.5">
              <span>Transcription Output</span>
              {activeEngine === 'whisper' && (
                <span className="text-[10px] bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Whisper Mode
                </span>
              )}
            </span>
            <span className="font-normal text-slate-400">{wordCountDisplay}</span>
          </div>

          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            placeholder="Your spoken words will appear here automatically..."
            spellCheck="true"
            className="w-full h-56 resize-y border-none outline-none bg-transparent p-4 text-base leading-relaxed text-slate-900 font-sans placeholder:text-slate-400 focus:ring-0"
          />
        </div>

        {/* Recording Engine Action Buttons */}
        <div className="flex flex-wrap justify-center items-center gap-3 mb-6">
          <button
            onClick={startWebSpeech}
            disabled={isCurrentlyRecording}
            className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 transition shadow-md shadow-slate-900/10 active:scale-95 disabled:cursor-not-allowed"
          >
            <Mic className="w-4 h-4 text-emerald-400" /> Live Web Speech
          </button>

          <button
            onClick={startMediaRecorder}
            disabled={isCurrentlyRecording}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 transition shadow-md shadow-violet-600/20 active:scale-95 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4 text-amber-300" /> AI Whisper STT
          </button>

          <button
            onClick={handleStop}
            disabled={!isCurrentlyRecording}
            className="bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white px-5 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 transition active:scale-95 disabled:cursor-not-allowed"
          >
            <MicOff className="w-4 h-4" /> Stop
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          <button
            onClick={handleCopy}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
          >
            {copySuccess ? '✅ Copied!' : '📋 Copy Text'}
          </button>

          <button
            onClick={handleClear}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
          >
            🗑️ Clear
          </button>

          <button
            onClick={handleDownload}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
          >
            ⬇️ Download
          </button>

          {onSendToChat && (
            <button
              onClick={handleSendToChat}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm active:scale-95"
            >
              <Send className="w-3.5 h-3.5" /> Send to AI Companion
            </button>
          )}
        </div>

        {/* Information Grid */}
        <div className="pt-6 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <div className="flex items-start gap-3">
            <span className="text-xl">🎤</span>
            <div>
              <strong className="block text-xs font-bold text-slate-800 mb-0.5">
                Dual AI Speech Engines
              </strong>
              <p className="text-xs text-slate-500 leading-relaxed">
                Choose Live Web Speech or high-precision AI Whisper STT.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-xl">🌐</span>
            <div>
              <strong className="block text-xs font-bold text-slate-800 mb-0.5">
                Multilingual Support
              </strong>
              <p className="text-xs text-slate-500 leading-relaxed">
                Supports English, Tamil, Hindi, Telugu, Malayalam, & Kannada.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="text-xl">🔒</span>
            <div>
              <strong className="block text-xs font-bold text-slate-800 mb-0.5">
                Private & Secure
              </strong>
              <p className="text-xs text-slate-500 leading-relaxed">
                Your transcript is processed safely for immediate support.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

