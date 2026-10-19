export const COLUMNS = [
  'nafdac_reg_no',
  'product_name',
  'manufacturer',
  'active_ingredient',
  'strength',
  'batch_no',
  'mfg_date',
  'expiry_date',
  'code_value',
] as const;
export type Column = (typeof COLUMNS)[number];

export const REQUIRED: readonly Column[] = [
  'nafdac_reg_no',
  'product_name',
  'manufacturer',
  'batch_no',
  'expiry_date',
  'code_value',
];

export type ImportRow = Record<Column, string> & { line: number };

/** line = row number in the file, where the header is line 1. */
export interface RowIssue {
  line: number;
  field: string;
  message: string;
}

export interface Validated {
  rows: ImportRow[];
  issues: RowIssue[];
}

const MAX_LEN: Partial<Record<Column, number>> = {
  nafdac_reg_no: 50,
  product_name: 200,
  manufacturer: 200,
  active_ingredient: 200,
  strength: 100,
  batch_no: 100,
  code_value: 256,
};

const FORBIDDEN = /["\\\u0000-\u001f]/;

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateRows(raw: Array<Record<string, string | undefined>>, headers: string[]): Validated {
  const issues: RowIssue[] = [];

  const missing = REQUIRED.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    for (const c of missing) issues.push({ line: 1, field: c, message: `Missing column "${c}"` });
    return { rows: [], issues };
  }

  const rows: ImportRow[] = [];
  const firstProduct = new Map<string, { name: string; manufacturer: string; line: number }>();
  const firstBatch = new Map<string, { mfg: string; expiry: string; line: number }>();
  const firstCode = new Map<string, number>();

  raw.forEach((rec, idx) => {
    const line = idx + 2;
    const row = { line } as ImportRow;
    let blank = true;
    for (const c of COLUMNS) {
      const v = String(rec[c] ?? '').trim();
      row[c] = v;
      if (v) blank = false;
    }
    if (blank) return; // empty lines are skipped, but line numbers stay true to the file

    for (const c of REQUIRED) {
      if (!row[c]) issues.push({ line, field: c, message: `${c} is required` });
    }
    for (const c of COLUMNS) {
      const max = MAX_LEN[c];
      if (max && row[c].length > max) issues.push({ line, field: c, message: `${c} is longer than ${max} characters` });
    }
    for (const c of ['nafdac_reg_no', 'batch_no', 'code_value'] as const) {
      if (row[c] && FORBIDDEN.test(row[c])) {
        issues.push({ line, field: c, message: `${c} contains characters that are not allowed (quotes, backslashes or control characters)` });
      }
    }

    const expiryOk = row.expiry_date !== '' && isValidDate(row.expiry_date);
    if (row.expiry_date && !expiryOk) {
      issues.push({ line, field: 'expiry_date', message: 'expiry_date must be a real date written as YYYY-MM-DD' });
    }
    const mfgOk = row.mfg_date === '' || isValidDate(row.mfg_date);
    if (!mfgOk) {
      issues.push({ line, field: 'mfg_date', message: 'mfg_date must be a real date written as YYYY-MM-DD (or left empty)' });
    }
    if (expiryOk && row.mfg_date && mfgOk && row.mfg_date > row.expiry_date) {
      issues.push({ line, field: 'mfg_date', message: 'mfg_date is after expiry_date' });
    }

    // The same NAFDAC number must always mean the same product.
    if (row.nafdac_reg_no && row.product_name && row.manufacturer) {
      const p = firstProduct.get(row.nafdac_reg_no);
      if (!p) {
        firstProduct.set(row.nafdac_reg_no, { name: row.product_name, manufacturer: row.manufacturer, line });
      } else {
        if (p.name !== row.product_name) {
          issues.push({ line, field: 'product_name', message: `differs from row ${p.line} for the same NAFDAC number` });
        }
        if (p.manufacturer !== row.manufacturer) {
          issues.push({ line, field: 'manufacturer', message: `differs from row ${p.line} for the same NAFDAC number` });
        }
      }
    }

    // The same batch must always have the same dates.
    if (row.nafdac_reg_no && row.batch_no && expiryOk && mfgOk) {
      const key = `${row.nafdac_reg_no}|${row.batch_no}`;
      const b = firstBatch.get(key);
      if (!b) {
        firstBatch.set(key, { mfg: row.mfg_date, expiry: row.expiry_date, line });
      } else {
        if (b.expiry !== row.expiry_date) {
          issues.push({ line, field: 'expiry_date', message: `differs from row ${b.line} for the same batch` });
        }
        if (b.mfg !== row.mfg_date) {
          issues.push({ line, field: 'mfg_date', message: `differs from row ${b.line} for the same batch` });
        }
      }
    }

    if (row.code_value) {
      const first = firstCode.get(row.code_value);
      if (first !== undefined) {
        issues.push({ line, field: 'code_value', message: `duplicate of the code in row ${first}` });
      } else {
        firstCode.set(row.code_value, line);
      }
    }

    rows.push(row);
  });

  return { rows, issues };
}