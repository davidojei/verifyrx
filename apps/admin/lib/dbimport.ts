import { supabase } from './supabase';
import type { ImportRow, RowIssue } from './importer';

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Filters travel in the URL, so keep each request small however long the values are.
function chunkByChars(values: string[], maxChars = 3000, maxItems = 200): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const v of values) {
    if (cur.length > 0 && (size + v.length > maxChars || cur.length >= maxItems)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(v);
    size += v.length + 3;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface DryRun {
  issues: RowIssue[];
  counts: { newProducts: number; newBatches: number; newCodes: number; alreadyPresent: number };
}

/** Compares the file with what is already in the database. Writes nothing. */
export async function dryRun(rows: ImportRow[]): Promise<DryRun> {
  const issues: RowIssue[] = [];
  const regs = [...new Set(rows.map((r) => r.nafdac_reg_no))];

  const products = new Map<string, { id: string; name: string; manufacturer: string }>();
  for (const part of chunkByChars(regs)) {
    const { data, error } = await supabase
      .from('products')
      .select('id,name,manufacturer,nafdac_reg_no')
      .in('nafdac_reg_no', part);
    if (error) throw new Error(`Could not read products: ${error.message}`);
    for (const p of data ?? []) products.set(p.nafdac_reg_no, { id: p.id, name: p.name, manufacturer: p.manufacturer });
  }

  const batches = new Map<string, { id: string; expiry: string; mfg: string | null }>();
  for (const part of chunkByChars([...products.values()].map((p) => p.id))) {
    const { data, error } = await supabase
      .from('batches')
      .select('id,product_id,batch_no,mfg_date,expiry_date')
      .in('product_id', part);
    if (error) throw new Error(`Could not read batches: ${error.message}`);
    for (const b of data ?? []) {
      batches.set(`${b.product_id}|${b.batch_no}`, { id: b.id, expiry: b.expiry_date, mfg: b.mfg_date });
    }
  }

  const existingCodes = new Map<string, string>();
  for (const part of chunkByChars(rows.map((r) => r.code_value))) {
    const { data, error } = await supabase.from('codes').select('code_value,batch_id').in('code_value', part);
    if (error) throw new Error(`Could not read codes: ${error.message}`);
    for (const c of data ?? []) existingCodes.set(c.code_value, c.batch_id);
  }

  let alreadyPresent = 0;
  const newBatchKeys = new Set<string>();
  for (const r of rows) {
    const p = products.get(r.nafdac_reg_no);
    const b = p ? batches.get(`${p.id}|${r.batch_no}`) : undefined;

    if (p && (p.name !== r.product_name || p.manufacturer !== r.manufacturer)) {
      issues.push({
        line: r.line,
        field: 'product_name',
        message: `this NAFDAC number already exists as "${p.name}" by ${p.manufacturer}`,
      });
    }
    if (b) {
      if (b.expiry !== r.expiry_date) {
        issues.push({ line: r.line, field: 'expiry_date', message: `this batch already exists with expiry ${b.expiry}` });
      } else if (b.mfg && r.mfg_date && b.mfg !== r.mfg_date) {
        issues.push({ line: r.line, field: 'mfg_date', message: `this batch already exists with manufacture date ${b.mfg}` });
      }
    } else {
      newBatchKeys.add(`${r.nafdac_reg_no}|${r.batch_no}`);
    }

    const existing = existingCodes.get(r.code_value);
    if (existing !== undefined) {
      if (!b || b.id !== existing) {
        issues.push({ line: r.line, field: 'code_value', message: 'this code already exists in a different batch' });
      } else {
        alreadyPresent++;
      }
    }
  }

  issues.sort((a, b) => a.line - b.line);
  return {
    issues,
    counts: {
      newProducts: regs.filter((x) => !products.has(x)).length,
      newBatches: newBatchKeys.size,
      newCodes: rows.length - alreadyPresent,
      alreadyPresent,
    },
  };
}

/**
 * Saves the rows. Existing products, batches and codes are left untouched, so running
 * the same import twice is safe. It is not one database transaction: if it stops part
 * way, fix the cause and run it again.
 */
export async function runImport(rows: ImportRow[], onProgress: (message: string) => void): Promise<void> {
  const firstByReg = new Map<string, ImportRow>();
  for (const r of rows) if (!firstByReg.has(r.nafdac_reg_no)) firstByReg.set(r.nafdac_reg_no, r);

  onProgress('Saving products...');
  const productRows = [...firstByReg.values()].map((r) => ({
    name: r.product_name,
    manufacturer: r.manufacturer,
    nafdac_reg_no: r.nafdac_reg_no,
    active_ingredient: r.active_ingredient || null,
    strength: r.strength || null,
  }));
  for (const part of chunks(productRows, 200)) {
    const { error } = await supabase.from('products').upsert(part, { onConflict: 'nafdac_reg_no', ignoreDuplicates: true });
    if (error) throw new Error(`Saving products failed: ${error.message}`);
  }

  const productId = new Map<string, string>();
  for (const part of chunkByChars([...firstByReg.keys()])) {
    const { data, error } = await supabase.from('products').select('id,nafdac_reg_no').in('nafdac_reg_no', part);
    if (error) throw new Error(`Reading products failed: ${error.message}`);
    for (const p of data ?? []) productId.set(p.nafdac_reg_no, p.id);
  }

  onProgress('Saving batches...');
  const firstBatch = new Map<string, ImportRow>();
  for (const r of rows) {
    const key = `${r.nafdac_reg_no}|${r.batch_no}`;
    if (!firstBatch.has(key)) firstBatch.set(key, r);
  }
  const batchRows = [...firstBatch.values()].map((r) => {
    const pid = productId.get(r.nafdac_reg_no);
    if (!pid) throw new Error(`Product ${r.nafdac_reg_no} was not saved`);
    return { product_id: pid, batch_no: r.batch_no, mfg_date: r.mfg_date || null, expiry_date: r.expiry_date };
  });
  for (const part of chunks(batchRows, 200)) {
    const { error } = await supabase.from('batches').upsert(part, { onConflict: 'product_id,batch_no', ignoreDuplicates: true });
    if (error) throw new Error(`Saving batches failed: ${error.message}`);
  }

  const regByProductId = new Map<string, string>();
  for (const [reg, id] of productId) regByProductId.set(id, reg);
  const batchId = new Map<string, string>();
  for (const part of chunkByChars([...productId.values()])) {
    const { data, error } = await supabase.from('batches').select('id,product_id,batch_no').in('product_id', part);
    if (error) throw new Error(`Reading batches failed: ${error.message}`);
    for (const b of data ?? []) {
      const reg = regByProductId.get(b.product_id);
      if (reg) batchId.set(`${reg}|${b.batch_no}`, b.id);
    }
  }

  const codeRows = rows.map((r) => {
    const bid = batchId.get(`${r.nafdac_reg_no}|${r.batch_no}`);
    if (!bid) throw new Error(`Batch ${r.batch_no} was not saved`);
    return { batch_id: bid, code_value: r.code_value };
  });
  let done = 0;
  for (const part of chunks(codeRows, 500)) {
    onProgress(`Saving codes... ${done} of ${codeRows.length}`);
    const { error } = await supabase.from('codes').upsert(part, { onConflict: 'code_value', ignoreDuplicates: true });
    if (error) throw new Error(`Saving codes failed: ${error.message}`);
    done += part.length;
  }
  onProgress('Done.');
}