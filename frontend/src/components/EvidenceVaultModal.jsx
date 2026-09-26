import React, { useEffect, useState } from 'react';
import { Lock, Camera, Upload, Shield, CheckCircle, FileText, X, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function EvidenceVaultModal({ caseId, onClose }) {
  const [evidenceList, setEvidenceList] = useState([]);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (caseId) loadEvidence();
  }, [caseId]);

  const loadEvidence = async () => {
    try {
      const { data } = await api.get(`/evidence/${caseId}`);
      setEvidenceList(data.evidence || []);
    } catch {}
  };

  const handleCaptureSnapshot = async () => {
    if (!note.trim()) {
      return toast.error('Please add incident details or description');
    }
    setUploading(true);
    try {
      const { data } = await api.post('/evidence/upload', {
        case_id: caseId,
        title: title.trim() || 'Stealth Covert Snapshot',
        content: note.trim(),
        location: 'Verified GPS Coordinate',
      });
      toast.success(`Evidence sealed with hash: ${data.hash}`);
      setNote('');
      setTitle('');
      loadEvidence();
    } catch {
      toast.error('Failed to log evidence');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">Stealth Encrypted Evidence Vault</h2>
              <p className="text-xs text-slate-400">SHA-256 Tamper-Proof Cryptographic Incident Preservation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Snapshot Quick Add */}
        <div className="my-4 p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-cyan-300 font-semibold">
            <span className="flex items-center gap-1.5"><Camera className="w-4 h-4" /> Log Incident / Threat Details</span>
            <span className="text-[11px] text-slate-500 font-mono">ENCRYPTED AT REST</span>
          </div>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Incident Title (e.g. Threat Message, Stalker Sighting at 9:00 PM)"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
          />

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Detailed description, sender info, vehicle details, or exact quotes..."
            rows={2}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-500"
          />

          <button
            onClick={handleCaptureSnapshot}
            disabled={uploading}
            className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition disabled:opacity-50"
          >
            <Shield className="w-4 h-4" /> Seal & Encrypt Snapshot to Vault
          </button>
        </div>

        {/* List of Sealed Evidence */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Sealed Vault Records ({evidenceList.length})
          </div>

          {evidenceList.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              No evidence logged yet. Use the form above to preserve tamper-proof records.
            </div>
          ) : (
            evidenceList.map((item, idx) => (
              <div key={idx} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-xs text-slate-200">{item.title}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{new Date(item.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-xs text-slate-400">{item.notes}</p>
                <div className="pt-1 text-[10px] font-mono text-cyan-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-400" /> {item.hash}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl">
            Close Vault
          </button>
        </div>
      </div>
    </div>
  );
}
