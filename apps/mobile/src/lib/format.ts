// Postgres sends microseconds (e.g. .123456); trim to milliseconds so every JS engine can read it.
function parse(iso: string): Date {
  return new Date(iso.replace(/(\.\d{3})\d+/, '$1'));
}

export function fmtDate(iso: string): string {
  const d = parse(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  const d = parse(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}