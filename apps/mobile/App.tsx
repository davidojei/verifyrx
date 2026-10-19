import { useEffect, useState } from 'react';
import { AppState, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HistoryScreen from './src/screens/HistoryScreen';
import PrivacyScreen from './src/screens/PrivacyScreen';
import ReportScreen from './src/screens/ReportScreen';
import ResultScreen from './src/screens/ResultScreen';
import ScanScreen from './src/screens/ScanScreen';
import { loadBundle } from './src/lib/cache';
import { flushOutbox, pendingCounts } from './src/lib/outbox';
import type { Outcome } from './src/lib/types';
import { syncNow } from './src/lib/verify';

type Route =
  | { name: 'scan' }
  | { name: 'result'; outcome: Outcome; code: string; fromHistory: boolean }
  | { name: 'history' }
  | { name: 'privacy' }
  | { name: 'report'; code: string | null };

const FLUSH_EVERY_MS = 45000;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'scan' });
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  async function refreshPending() {
    const c = await pendingCounts();
    setPending(c.reports + c.scans);
  }

  async function runFlush() {
    try {
      await flushOutbox();
    } finally {
      await refreshPending();
    }
  }

  useEffect(() => {
    void (async () => {
      const saved = await loadBundle();
      if (saved) setSyncedAt(saved.synced_at);
      const fresh = await syncNow();
      if (fresh) setSyncedAt(fresh);
    })();
    void refreshPending();
    void runFlush();
    const timer = setInterval(() => {
      void runFlush();
    }, FLUSH_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void runFlush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'scan') return false;
      if (route.name === 'result' && route.fromHistory) setRoute({ name: 'history' });
      else setRoute({ name: 'scan' });
      return true;
    });
    return () => sub.remove();
  }, [route]);

  let screen;
  switch (route.name) {
    case 'result':
      screen = (
        <ResultScreen
          outcome={route.outcome}
          code={route.code}
          backLabel={route.fromHistory ? 'Back to history' : 'Scan another medicine'}
          onBack={() => setRoute(route.fromHistory ? { name: 'history' } : { name: 'scan' })}
          onReport={() => setRoute({ name: 'report', code: route.code })}
        />
      );
      break;
    case 'history':
      screen = (
        <HistoryScreen
          onBack={() => setRoute({ name: 'scan' })}
          onOpen={(e) => setRoute({ name: 'result', outcome: e.outcome, code: e.code, fromHistory: true })}
        />
      );
      break;
    case 'privacy':
      screen = <PrivacyScreen onBack={() => setRoute({ name: 'scan' })} />;
      break;
    case 'report':
      screen = (
        <ReportScreen
          initialCode={route.code}
          onDone={() => {
            void refreshPending();
            setRoute({ name: 'scan' });
          }}
        />
      );
      break;
    default:
      screen = (
        <ScanScreen
          syncedAt={syncedAt}
          pending={pending}
          onOutcome={(outcome, code) => {
            void refreshPending();
            setRoute({ name: 'result', outcome, code, fromHistory: false });
          }}
          onHistory={() => setRoute({ name: 'history' })}
          onPrivacy={() => setRoute({ name: 'privacy' })}
          onReport={() => setRoute({ name: 'report', code: null })}
        />
      );
  }

  const light = route.name === 'scan' || route.name === 'result';
  return (
    <SafeAreaProvider>
      <StatusBar style={light ? 'light' : 'dark'} />
      {screen}
    </SafeAreaProvider>
  );
}