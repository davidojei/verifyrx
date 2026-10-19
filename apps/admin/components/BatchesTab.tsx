'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

interface BatchRow {
  id: string;
  batch_no: string;
  mfg_date: string | null;
  expiry_date: string;
  status: 'ok' | 'recalled';
  products: { name: string; manufacturer: string; nafdac_reg_no: string } | null;
}

export default function BatchesTab({ filter, setFilter }: { filter: string; setFilter: (v: string) => void }) {
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('batches')
      .select('id,batch_no,mfg_date,expiry_date,status,products(name,manufacturer,nafdac_reg_no)')
      .order('expiry_date', { ascending: true })
      .limit(1000);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((data ?? []) as unknown as BatchRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = rows ?? [];
    if (!q) return all;
    return all.filter(
      (b) =>
        b.batch_no.toLowerCase().includes(q) ||
        (b.products?.name ?? '').toLowerCase().includes(q) ||
        (b.products?.nafdac_reg_no ?? '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  async function toggle(b: BatchRow) {
    const next = b.status === 'ok' ? 'recalled' : 'ok';
    const { count } = await supabase.from('codes').select('id', { count: 'exact', head: true }).eq('batch_id', b.id);
    const msg =
      next === 'recalled'
        ? `Mark batch ${b.batch_no} as RECALLED? All ${count ?? 0} codes in it will show a warning in the app.`
        : `Remove the recall from batch ${b.batch_no}? Its ${count ?? 0} codes will stop showing the recall warning.`;
    if (!window.confirm(msg)) return;
    const { error: err } = await supabase.from('batches').update({ status: next }).eq('id', b.id);
    if (err) setError(err.message);
    else await load();
  }

  return (
    <section>
      <h2>Batches and recalls</h2>
      <p className="muted">
        Online checks use a recall straight away. Phones refresh their offline copy the next time the app opens with internet, so an offline phone may not show a new recall until then.
      </p>
      <input placeholder="Search by batch number, product name or NAFDAC number" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p>Loading...</p>}
      {rows !== null && shown.length === 0 && <p>No batches match.</p>}

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.products?.name ?? '?'}
                  <div className="muted">{b.products?.nafdac_reg_no}</div>
                </td>
                <td className="mono">{b.batch_no}</td>
                <td>
                  {b.expiry_date}
                  {b.expiry_date < today && <div className="error">expired</div>}
                </td>
                <td>
                  <span className={`badge ${b.status}`}>{b.status}</span>
                </td>
                <td>
                  <button className={b.status === 'ok' ? 'danger' : 'secondary'} onClick={() => void toggle(b)}>
                    {b.status === 'ok' ? 'Recall' : 'Remove recall'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}