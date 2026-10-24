/** Global selection + navigation in the URL hash so every screen is deep-linkable. */
import { useEffect, useState, useCallback } from 'react';

export const VIEWS = ['today', 'pipeline', 'people', 'reporting'];
export function parseHash() {
  const h = window.location.hash.replace(/^#/, '');
  const out = {};
  if (!h) return out;
  if (!h.includes('=')) { out.view = h; return out; }
  for (const part of h.split('&')) { const [k, v] = part.split('='); if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return out;
}
export function writeHash(state) {
  const parts = Object.entries(state).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const next = '#' + parts.join('&');
  if (window.location.hash !== next) { try { history.replaceState(null, '', next); } catch (e) { window.location.hash = next; } }
}
export function useUrlState(defaults) {
  const [state, setState] = useState(() => ({ ...defaults, ...parseHash() }));
  useEffect(() => { writeHash(state); }, [state]);
  useEffect(() => { const on = () => setState((s) => ({ ...s, ...parseHash() })); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const update = useCallback((patch) => setState((s) => ({ ...s, ...patch })), []);
  return [state, update];
}
export function usePref(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem('al.' + key); return s == null ? initial : JSON.parse(s); } catch (e) { return initial; } });
  const set = useCallback((x) => { setV(x); try { localStorage.setItem('al.' + key, JSON.stringify(x)); } catch (e) { /* ignore */ } }, [key]);
  return [v, set];
}
export function useMedia(query) {
  const [m, setM] = useState(() => (window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => { const mq = window.matchMedia(query); const on = () => setM(mq.matches); mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on); return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on)); }, [query]);
  return m;
}
