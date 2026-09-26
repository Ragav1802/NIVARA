import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
export const API_BASE = `${BACKEND_URL}/api`;


export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('nivara_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export function connectWS(onMessage) {
  const token = localStorage.getItem('nivara_token');
  if (!token) return null;
  const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + `/api/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try { onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore */ }
  };
  return ws;
}
