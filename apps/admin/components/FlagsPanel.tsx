'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Flag {
  flag: string;
  country: string;
  enabled: boolean;
}

const LABELS: Record<string, string> = {
  photo_analysis: 'Packaging photo analysis',
  pill_id: 'Pill identification',
  retain_photos: 'Let users choose to keep their analysis photos',
};

export default function FlagsPanel() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('flag,country,enabled')
      .order('flag')
      .order('country');
    if (error) {
      setMessage({ text: error.message, ok: false });
      return;
    }
    setFlags((data ?? []) as Flag[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(f: Flag) {
    const next = !f.enabled;
    const label = LABELS[f.flag] ?? f.flag;
    const where = f.country === '*' ? 'everywhere' : f.country;
    if (!window.confirm(`Turn "${label}" ${next ? 'ON' : 'OFF'} for ${where}?`)) return;
    setMessage(null);
    const { error } = await supabase
      .from('feature_flags')
      .update({ enabled: next })
      .eq('flag', f.flag)
      .eq('country', f.country);
    if (error) setMessage({ text: error.message, ok: false });
    else {
      setMessage({ text: 'Saved.', ok: true });
      await load();
    }
  }

  return (
    <div className="card">
      <h2>Feature flags</h2>
      <p className="muted">
        Switches for the photo features. They apply to new requests straight away, with no redeploy. A country row overrides the
        everywhere row. Keep them OFF until the evaluation results are in.
      </p>
      {flags === null && !message && <p>Loading...</p>}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Where</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(flags ?? []).map((f) => (
              <tr key={`${f.flag}-${f.country}`}>
                <td>{LABELS[f.flag] ?? f.flag}</td>
                <td>{f.country === '*' ? 'everywhere' : f.country}</td>
                <td>
                  <span className={`badge ${f.enabled ? 'ok' : ''}`}>{f.enabled ? 'ON' : 'OFF'}</span>
                </td>
                <td>
                  <button className={f.enabled ? 'danger' : 'secondary'} onClick={() => void toggle(f)}>
                    {f.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <p className={message.ok ? 'ok' : 'error'}>{message.text}</p>}
    </div>
  );
}