import { useEffect, useState } from 'react';
import { api } from './api.js';
/** Load a route; returns { data, error, loading }. Re-runs when params change. */
export function useRoute(route, params, enabled = true) {
  const key = JSON.stringify(params);
  const [st, setSt] = useState({ data: null, error: null, loading: !!enabled });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    api(route, params).then((d) => alive && setSt({ data: d, error: null, loading: false })).catch((e) => alive && setSt({ data: null, error: e, loading: false }));
    return () => { alive = false; };
  }, [route, key, enabled]); // eslint-disable-line
  return st;
}
