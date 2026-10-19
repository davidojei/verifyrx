'use client';

import Papa from 'papaparse';
import { useState } from 'react';
import { COLUMNS, validateRows, type ImportRow, type RowIssue } from '../lib/importer';
import { dryRun, runImport, type DryRun } from '../lib/dbimport';

type Stage = 'idle' | 'checking' | 'ready' | 'importing' | 'done';
const MAX_SHOWN = 200;

export default function ImportTab() {
  const [stage, setStage] = useState<Stage>('idle');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStage('idle');
    setRows([]);
    setIssues([]);
    setDry(null);
    setProgress('');
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets you pick the same file again after fixing it
    if (!file) return;
    reset();
    setFileName(file.name);
    if (file.size > 10 * 1024 * 1024) {
      setError('This file is larger than 10 MB. Please split it into smaller files.');
      return;
    }
    setStage('checking');
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: false,
        transformHeader: (h) => h.replace(/^\uFEFF/, '').trim().toLowerCase(),
      });
      const v = validateRows(parsed.data, parsed.meta.fields ?? []);
      setRows(v.rows);
      setIssues(v.issues);
      if (v.issues.length > 0) {
        setStage('idle');
        return;
      }
      if (v.rows.length === 0) {
        setError('The file has no data rows.');
        setStage('idle');
        return;
      }
      const d = await dryRun(v.rows);
      setDry(d);
      setIssues(d.issues);
      setStage(d.issues.length === 0 ? 'ready' : 'idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while checking the file.');
      setStage('idle');
    }
  }

  async function doImport() {
    if (!window.confirm(`Import ${rows.length} rows? They will count as known codes in the app straight away.`)) return;
    setStage('importing');
    setError(null);
    try {
      await runImport(rows, setProgress);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import stopped. Fix the cause and run it again; finished parts are not duplicated.');
      setStage('ready');
    }
  }

  function downloadTemplate() {
    const csv =
      COLUMNS.join(',') +
      '\nDEMO-A4-0100,Example Tablets,Example Pharma Ltd,Paracetamol,500 mg,B-0001,2026-01-01,2028-12-31,EXAMPLE-CODE-0001\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'verifyrx-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>Import products, batches and codes</h2>
      <div className="warnbox">
        Everything imported here will show as &quot;Matches our records&quot; in the app. Only import data from a source you trust, such as the manufacturer or NAFDAC.
      </div>

      <div className="card">
        <p>
          One row per code. Columns: <span className="mono">{COLUMNS.join(', ')}</span>. Dates are written YYYY-MM-DD. Required: everything except active_ingredient, strength and mfg_date.
        </p>
        <p className="muted">
          Tip: open CSV files in Notepad, not Excel. Excel silently changes dates and drops leading zeros from codes.
        </p>
        <div className="actions">
          <button className="secondary" onClick={downloadTemplate}>
            Download template
          </button>
        </div>
        <label htmlFor="csv">Choose a CSV file</label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} disabled={stage === 'checking' || stage === 'importing'} />
      </div>

      {stage === 'checking' && <p>Checking {fileName}...</p>}
      {error && <p className="error">{error}</p>}

      {issues.length > 0 && (
        <div className="card">
          <p className="error">
            <strong>
              {issues.length} problem{issues.length === 1 ? '' : 's'} in {fileName}. Nothing was imported. Fix the file and choose it again.
            </strong>
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Column</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {issues.slice(0, MAX_SHOWN).map((i, n) => (
                  <tr key={n}>
                    <td>{i.line}</td>
                    <td className="mono">{i.field}</td>
                    <td>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issues.length > MAX_SHOWN && <p className="muted">...and {issues.length - MAX_SHOWN} more.</p>}
          <p className="muted">Row 1 is the header line, so the first data row is row 2.</p>
        </div>
      )}

      {dry && issues.length === 0 && stage !== 'done' && (
        <div className="card">
          <p className="ok">{fileName} passed all checks.</p>
          <ul>
            <li>{dry.counts.newProducts} new product(s)</li>
            <li>{dry.counts.newBatches} new batch(es)</li>
            <li>{dry.counts.newCodes} new code(s)</li>
            <li>{dry.counts.alreadyPresent} code(s) already in the database (left unchanged)</li>
          </ul>
          <button onClick={() => void doImport()} disabled={stage !== 'ready'}>
            {stage === 'importing' ? 'Importing...' : `Import ${rows.length} rows`}
          </button>
          {stage === 'importing' && <p className="muted">{progress}</p>}
        </div>
      )}

      {stage === 'done' && (
        <div className="card">
          <p className="ok">Import finished.</p>
          <button className="secondary" onClick={reset}>
            Import another file
          </button>
        </div>
      )}
    </section>
  );
}