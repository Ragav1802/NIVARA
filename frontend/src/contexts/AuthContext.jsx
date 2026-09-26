import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(localStorage.getItem('nivara_lang') || 'en');

  const changeLang = useCallback((l) => {
    setLang(l);
    localStorage.setItem('nivara_lang', l);
  }, []);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('nivara_token');
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch (e) {
      localStorage.removeItem('nivara_token');
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('nivara_token', data.token);
    setUser(data.user);
    return data.user;
  };
  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    localStorage.setItem('nivara_token', data.token);
    setUser(data.user);
    return data.user;
  };
  const logout = () => {
    localStorage.removeItem('nivara_token');
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refresh, lang, setLang: changeLang }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
