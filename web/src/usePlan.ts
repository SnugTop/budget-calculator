import { useCallback, useEffect, useRef, useState } from 'react';
import { freezePast } from '../../shared/core';
import type { ISODate, Plan } from '../../shared/types';
import { api, ApiError } from './api';

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'conflict';

/**
 * Holds one plan in memory. Every change shows at once and is saved to the
 * server shortly after. A save is refused if another device saved first.
 */
export function usePlan(planId: number | null, today: ISODate) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [reloads, setReloads] = useState(0);

  const latest = useRef<Plan | null>(null);
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idRef = useRef(planId);

  const flush = useCallback(async () => {
    const id = idRef.current;
    if (saving.current || !dirty.current || !latest.current || id == null) return;
    saving.current = true;
    dirty.current = false;
    setStatus('saving');
    try {
      const res = await api.save(id, latest.current, version.current);
      if (idRef.current !== id) return;
      version.current = res.version;
      setStatus(dirty.current ? 'saving' : 'saved');
    } catch (e) {
      if (idRef.current !== id) return;
      if (e instanceof ApiError && e.status === 409) {
        setStatus('conflict');
        return;
      }
      // Keep the change and try again shortly.
      dirty.current = true;
      setStatus('offline');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 4000);
    } finally {
      saving.current = false;
    }
    if (dirty.current) void flush();
  }, []);

  useEffect(() => {
    idRef.current = planId;
    latest.current = null;
    dirty.current = false;
    clearTimeout(timer.current);
    setPlan(null);
    setStatus('loading');
    if (planId == null) return;
    let cancelled = false;
    api
      .plan(planId)
      .then((row) => {
        if (cancelled) return;
        version.current = row.version;
        const frozen = freezePast(row.data, today);
        latest.current = frozen;
        setName(row.name);
        setPlan(frozen);
        setStatus('saved');
        if (frozen !== row.data) {
          dirty.current = true;
          void flush();
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('offline');
      });
    return () => {
      cancelled = true;
      // Leaving this plan: send any change that has not been saved yet.
      clearTimeout(timer.current);
      if (dirty.current && latest.current && !saving.current) {
        void api.save(planId, latest.current, version.current).catch(() => {});
      }
    };
  }, [planId, today, reloads, flush]);

  const update = useCallback(
    (fn: (p: Plan) => Plan) => {
      if (!latest.current) return;
      const next = fn(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      dirty.current = true;
      setPlan(next);
      setStatus((s) => (s === 'conflict' ? s : 'saving'));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 350);
    },
    [flush],
  );

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  return { plan, name, status, update, reload };
}
