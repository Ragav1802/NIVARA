import React, { useState, useEffect } from 'react';
import { api, connectWS } from '@/lib/api';
import { Bell, Check, CheckCheck, ShieldAlert, Sparkles, X, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadNotifications();

    const ws = connectWS((msg) => {
      if (['sos', 'sos_routed', 'risk_escalation', 'counsellor_assigned', 'weekly_digest', 'case_update'].includes(msg.type)) {
        loadNotifications();
      }
    });

    return () => ws && ws.close();
  }, []);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/notifications');
      setNotifications(data || []);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id, e) => {
    e.stopPropagation();
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      toast.success('Notification marked as read');
    } catch {
      toast.error('Failed to mark notification');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-300 hover:text-white rounded-full hover:bg-slate-800/60 transition-all focus:outline-none"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-lg animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 z-50 rounded-2xl bg-slate-900/95 border border-slate-700/60 shadow-2xl backdrop-blur-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700/50">
              <div className="flex items-center space-x-2">
                <Bell className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-sm text-slate-100">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full font-medium">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center text-xs text-slate-400 hover:text-cyan-300 px-2 py-1 rounded-md hover:bg-slate-700/50 transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5 mr-1" />
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Notification List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs flex flex-col items-center">
                  <Info className="w-8 h-8 mb-2 text-slate-600" />
                  No new notifications right now
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={(e) => !n.read && markAsRead(n.id, e)}
                    className={`p-3 text-xs transition-all flex items-start justify-between cursor-pointer ${
                      n.read
                        ? 'bg-slate-900/40 text-slate-400 opacity-70 hover:opacity-100'
                        : 'bg-slate-800/40 text-slate-200 font-medium hover:bg-slate-800/70 border-l-2 border-cyan-400'
                    }`}
                  >
                    <div className="flex items-start space-x-2 pr-2">
                      {n.kind.includes('sos') ? (
                        <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      ) : n.kind.includes('digest') ? (
                        <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                          {n.title}
                        </div>
                        <p className="text-slate-400 text-[11px] mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          {new Date(n.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    {!n.read && (
                      <button
                        onClick={(e) => markAsRead(n.id, e)}
                        className="p-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex-shrink-0"
                        title="Mark as read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
