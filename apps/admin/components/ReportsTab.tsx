'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Status = 'new' | 'reviewed' | 'confirmed_fake';

interface Report {
  id: string;
  code_value: string | null;
  product_name_text: string | null;
  photo_url: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  status: Status;
  created_at: string;
}

const BUCKET = 'report-photos';

export default function ReportsTab({ onOpenBatch }: { onOpenBatch: (code: string) => Promise<void> }) {
  const [filter, setFilter] = useState<'all' | Status>('new');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    let q = supabase.from('reports').select('*');
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error: err } = await q.order('created_at', { ascending: false }).limit(200);
    if (err) {
      setError(err.message);
      return;
    }
    const rows = (data ?? []) as Report[];
    setReports(rows);

    const paths = rows.flatMap((r) => (r.photo_url ? r.photo_url.split(',') : []));
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
    const map: Record<string, string> = {};
    for (const s of signed ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
    setUrls(map);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(r: Report, status: Status) {
    if (status === 'confirmed_fake') {
      const extra = r.code_value
        ? 'If this code is in your database, every future check of it will show a warning.'
        : 'This report has no code, so it will not change anything in the app.';
      if (!window.confirm(`Confirm this report as a fake? ${extra}`)) return;
    }
    const { error: err } = await supabase.from('reports').update({ status }).eq('id', r.id);
    if (err) setError(err.message);
    else await load();
  }

  return (
    <section>
      <div className="row">
        <h2>Reports</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Status)}>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="confirmed_fake">Confirmed fake</option>
          <option value="all">All</option>
        </select>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className="muted">Reports are claims from the public. Check the photos and details before confirming one as fake.</p>
      {error && <p className="error">{error}</p>}
      {reports === null && !error && <p>Loading...</p>}
      {reports !== null && reports.length === 0 && <p>No reports here.</p>}

      {(reports ?? []).map((r) => (
        <article key={r.id} className="card">
          <div className="row">
            <span className={`badge ${r.status}`}>{r.status.replace('_', ' ')}</span>
            <span className="muted">{new Date(r.created_at).toLocaleString()}</span>
          </div>
          {r.code_value && (
            <p>
              Code: <span className="mono">{r.code_value}</span>
            </p>
          )}
          {r.product_name_text && <p>Product: {r.product_name_text}</p>}
          {r.notes && <pre className="notes">{r.notes}</pre>}
          {r.lat !== null && r.lng !== null && (
            <p className="muted">
              Approximate area:{' '}
              <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=13/${r.lat}/${r.lng}`} target="_blank" rel="noreferrer">
                {r.lat}, {r.lng}
              </a>
            </p>
          )}
          {r.photo_url && (
            <div className="thumbs">
              {r.photo_url.split(',').map((p) =>
                urls[p] ? (
                  <a key={p} href={urls[p]} target="_blank" rel="noreferrer">
                    <img src={urls[p]} alt="Packaging photo" loading="lazy" />
                  </a>
                ) : (
                  <span key={p} className="muted">
                    photo unavailable
                  </span>
                ),
              )}
            </div>
          )}
          <div className="actions">
            {r.status !== 'reviewed' && (
              <button className="secondary" onClick={() => void setStatus(r, 'reviewed')}>
                Mark reviewed
              </button>
            )}
            {r.status !== 'confirmed_fake' && (
              <button className="danger" onClick={() => void setStatus(r, 'confirmed_fake')}>
                Confirm fake
              </button>
            )}
            {r.status !== 'new' && (
              <button className="secondary" onClick={() => void setStatus(r, 'new')}>
                Back to new
              </button>
            )}
            {r.code_value && (
              <button className="secondary" onClick={() => void onOpenBatch(r.code_value as string)}>
                Open batch
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}