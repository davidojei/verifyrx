'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Login from '../components/Login';
import ReportsTab from '../components/ReportsTab';
import ImportTab from '../components/ImportTab';
import BatchesTab from '../components/BatchesTab';
import SettingsTab from '../components/SettingsTab';

type Phase = 'loading' | 'login' | 'denied' | 'ready';
type Tab = 'reports' | 'import' | 'batches' | 'settings';

async function checkAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<Tab>('reports');
  const [batchFilter, setBatchFilter] = useState('');
  const [email, setEmail] = useState('');

  const evaluate = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setPhase('login');
      return;
    }
    // The phone app signs in anonymously; those sessions are never admins.
    if (await checkAdmin()) {
      setEmail(session.user.email ?? '');
      setPhase('ready');
    } else {
      setPhase('denied');
    }
  }, []);

  useEffect(() => {
    void evaluate();
    const { data } = supabase.auth.onAuthStateChange(() => {
      // Deferred on purpose: calling Supabase inside this callback directly can deadlock.
      setTimeout(() => void evaluate(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [evaluate]);

  async function openBatch(code: string) {
    const { data, error } = await supabase
      .from('codes')
      .select('batches(batch_no)')
      .eq('code_value', code)
      .maybeSingle();
    const batchNo = (data as unknown as { batches: { batch_no: string } | null } | null)?.batches?.batch_no;
    if (error || !batchNo) {
      window.alert('That code is not in your database, so there is no batch to open.');
      return;
    }
    setBatchFilter(batchNo);
    setTab('batches');
  }

  if (phase === 'loading') {
    return (
      <main className="page">
        <p>Loading...</p>
      </main>
    );
  }
  if (phase === 'login') return <Login />;
  if (phase === 'denied') {
    return (
      <main className="card narrow">
        <h1>Not an admin account</h1>
        <p>This login does not have admin access.</p>
        <button onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="header">
        <h1>VerifyRx Admin</h1>
        <div className="row">
          <span className="muted">{email}</span>
          <button className="secondary" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="tabs">
        {(['reports', 'import', 'batches', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'reports' ? 'Reports' : t === 'import' ? 'Import' : t === 'batches' ? 'Batches' : 'Settings'}
          </button>
        ))}
      </div>

      {tab === 'reports' && <ReportsTab onOpenBatch={openBatch} />}
      {tab === 'import' && <ImportTab />}
      {tab === 'batches' && <BatchesTab filter={batchFilter} setFilter={setBatchFilter} />}
      {tab === 'settings' && <SettingsTab />}
    </main>
  );
}