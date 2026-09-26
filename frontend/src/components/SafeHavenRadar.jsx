import React, { useEffect, useState } from 'react';
import { Shield, Navigation, Phone, MapPin, Radio, X, ExternalLink, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function SafeHavenRadar({ onClose }) {
  const [havens, setHavens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHaven, setSelectedHaven] = useState(null);

  useEffect(() => {
    loadHavens();
  }, []);

  const loadHavens = async () => {
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { data } = await api.get(`/safe-havens?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
            setHavens(data.havens || []);
            setLoading(false);
          },
          async () => {
            const { data } = await api.get('/safe-havens');
            setHavens(data.havens || []);
            setLoading(false);
          }
        );
      } else {
        const { data } = await api.get('/safe-havens');
        setHavens(data.havens || []);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const startNavigation = (haven) => {
    toast.success(`Safe route locked to: ${haven.name}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${haven.latitude},${haven.longitude}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-400">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">Safe Haven Radar & Emergency Safe-Zones</h2>
              <p className="text-xs text-slate-400">Real-time certified physical shelters, police hubs & medical safe-havens</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tactical Radar Display Banner */}
        <div className="my-4 bg-slate-950 rounded-2xl p-4 border border-slate-800/80 flex items-center justify-between relative overflow-hidden">
          <div className="relative z-10 space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-teal-400 uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
              Active Radar Scanner Active
            </div>
            <p className="text-xs text-slate-400">
              {havens.length} safe locations identified within a 2.5 km secure corridor.
            </p>
          </div>
          <div className="w-16 h-16 rounded-full border border-teal-500/30 flex items-center justify-center relative">
            <div className="absolute inset-0 rounded-full border-t-2 border-teal-400 animate-spin" />
            <Shield className="w-6 h-6 text-teal-400" />
          </div>
        </div>

        {/* List of Havens */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm">Scanning secure perimeters...</div>
          ) : havens.map((haven) => (
            <div
              key={haven.id}
              onClick={() => setSelectedHaven(haven)}
              className={`p-4 rounded-2xl border transition cursor-pointer ${
                selectedHaven?.id === haven.id
                  ? 'bg-slate-800/90 border-teal-400/80 shadow-lg shadow-teal-500/10'
                  : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${
                      haven.type === 'police' ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30' :
                      haven.type === 'shelter' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' :
                      'bg-purple-500/20 text-purple-300 border border-purple-400/30'
                    }`}>
                      {haven.type}
                    </span>
                    <span className="text-xs text-teal-300 font-semibold">{haven.distance_km} km away</span>
                  </div>
                  <h3 className="font-bold text-slate-100 text-sm mt-1">{haven.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-500" /> {haven.address}
                  </p>
                </div>

                <div className="text-right text-xs">
                  <span className="text-emerald-400 font-semibold block">{haven.status}</span>
                  <span className="text-[11px] text-slate-500">{haven.security_level}</span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                <span className="text-xs text-slate-400">📞 {haven.phone}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startNavigation(haven);
                  }}
                  className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow transition"
                >
                  <Navigation className="w-3.5 h-3.5" /> Navigate Safe Route
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
          >
            Close Radar
          </button>
        </div>
      </div>
    </div>
  );
}
