import React, { useEffect, useState } from 'react';
import { ShieldCheck, CheckSquare, Square, Download, Sparkles, X, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function AISafetyPlanModal({ caseId, onClose }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completedSteps, setCompletedSteps] = useState({});

  useEffect(() => {
    generatePlan();
  }, []);

  const generatePlan = async () => {
    try {
      const { data } = await api.post('/safety-plan/generate', { case_id: caseId });
      setPlan(data);
      const init = {};
      data.steps?.forEach((s) => {
        init[s.id] = s.completed;
      });
      setCompletedSteps(init);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  const toggleStep = (id) => {
    setCompletedSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const downloadPlan = () => {
    if (!plan) return;
    const content = `NIVARA PERSONALIZED SAFETY & EMERGENCY ACTION PLAN\n` +
      `Generated: ${new Date().toLocaleString()}\n` +
      `Target: ${plan.victim_name}\n` +
      `Assessed Risk Level: ${plan.risk_category}\n\n` +
      `=== ACTION STEPS & PROTOCOLS ===\n\n` +
      plan.steps.map((s, idx) => 
        `[${completedSteps[s.id] ? 'COMPLETED' : 'PENDING'}] Step ${idx + 1}: ${s.title} (${s.priority} Priority)\n` +
        `Category: ${s.category}\n` +
        `Instructions: ${s.desc}\n`
      ).join('\n-------------------------\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Nivara_Personal_Safety_Plan.txt`;
    link.click();
    toast.success('Emergency Plan downloaded');
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-400/40 flex items-center justify-center text-violet-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">AI Emergency Action & Protection Strategy</h2>
              <p className="text-xs text-slate-400">Customized 5-Pillar protocol tailored to your case risks</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <Sparkles className="w-6 h-6 text-violet-400 animate-spin mx-auto mb-2" />
            Synthesizing personalized safety checklist...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 py-4 pr-1">
            {plan?.steps?.map((step) => {
              const done = completedSteps[step.id];
              return (
                <div
                  key={step.id}
                  onClick={() => toggleStep(step.id)}
                  className={`p-4 rounded-2xl border transition cursor-pointer flex items-start gap-3 ${
                    done
                      ? 'bg-emerald-950/30 border-emerald-500/30'
                      : 'bg-slate-950/60 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <button className="mt-0.5 text-emerald-400">
                    {done ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-500" />}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-violet-300 border border-slate-700">
                        {step.category}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        step.priority === 'Critical' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
                      }`}>
                        {step.priority} Priority
                      </span>
                    </div>

                    <h3 className={`font-bold text-sm mt-1 ${done ? 'line-through text-slate-400' : 'text-slate-100'}`}>
                      {step.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
          <span className="text-xs text-slate-500">
            {Object.values(completedSteps).filter(Boolean).length} of {plan?.steps?.length || 0} actions secured
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700">
              Close
            </button>
            <button onClick={downloadPlan} className="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow">
              <Download className="w-3.5 h-3.5" /> Download Safety Checklist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
