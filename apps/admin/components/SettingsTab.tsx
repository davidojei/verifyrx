'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Cfg {
  key: string;
  value: number;
}

const INFO: Record<string, string> = {
  flag_at_devices: 'Show a warning when a code has been scanned on this many different phones, or more',
  flag_at_areas: 'Show a warning when a code has been scanned in this many different areas, or more',
  flag_at_scans: 'Show a warning when a code has been scanned this many times in total, or more',
  flag_at_reports: 'Show a warning when this many different people have an open report on a code, or more',
  area_cell_km: 'Size of one "area" in kilometres (used to count different areas)',
  max_reports_per_hour: 'Reports one phone may send per hour',
  max_scans_per_minute: 'Code checks one phone may make per minute (stops people guessing codes)',
  rescan_window_hours: 'Hours during which the same phone checking the same code again does not count as a new scan (0 = count every scan)',
};

const ALLOW_ZERO = new Set(['rescan_window_hours']);

export default function SettingsTab() {
  const [rows, setRows] = useState<Cfg[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('app_config').select('key,value').order('key');
    if (error) {
      setMessage({ text: error.message, ok: false });
      return;
    }
    const list = ((data ?? []) as Cfg[]).map((r) => ({ key: r.key, value: Number(r.value) }));
    setRows(list);
    setEdits(Object.fromEntries(list.map((r) => [r.key, String(r.value)])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setMessage(null);
    const changes: Cfg[] = [];
    for (const r of rows ?? []) {
      const n = Number(edits[r.key]);
      const zeroOk = ALLOW_ZERO.has(r.key);
      if (!Number.isFinite(n) || (zeroOk ? n < 0 : n <= 0)) {
        setMessage({ text: `${r.key} must be a number ${zeroOk ? 'of 0 or more' : 'greater than 0'}.`, ok: false });
        return;
      }
      if ((r.key.startsWith('flag_at_') || r.key.startsWith('max_')) && !Number.isInteger(n)) {
        setMessage({ text: `${r.key} must be a whole number.`, ok: false });
        return;
      }
      if (n !== r.value) changes.push({ key: r.key, value: n });
    }
    if (changes.length === 0) {
      setMessage({ text: 'Nothing to save.', ok: true });
      return;
    }
    const { error } = await supabase.from('app_config').upsert(changes);
    if (error) setMessage({ text: error.message, ok: false });
    else {
      setMessage({ text: 'Saved.', ok: true });
      await load();
    }
  }

  return (
    <section>
      <h2>Settings</h2>
      <div className="warnbox">
        Online checks use these settings straight away. Phones receive them together with the offline data, the next time the app opens with internet. Until then an offline phone uses its last saved copy.
      </div>
      <div className="card">
        {rows === null && <p>Loading...</p>}
        {(rows ?? []).map((r) => (
          <div key={r.key}>
            <label htmlFor={r.key}>
              <span className="mono">{r.key}</span>
            </label>
            <input id={r.key} inputMode="decimal" value={edits[r.key] ?? ''} onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })} />
            <div className="muted">{INFO[r.key] ?? ''}</div>
          </div>
        ))}
        {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
        <p>
          <button onClick={() => void save()}>Save changes</button>
        </p>
      </div>
    </section>
  );
}