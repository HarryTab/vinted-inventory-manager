import 'dotenv/config';
import { parse } from 'csv-parse/sync';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const importDir = process.argv[2] || path.resolve('data-import');

const csvJobs = [
  {
    file: 'Inventory.csv',
    table: 'inventory',
    map: {
      'Item ID': 'item_id',
      Barcode: 'barcode',
      Title: 'title',
      Category: 'category',
      Brand: 'brand',
      Size: 'size',
      Condition: 'condition',
      Color: 'color',
      'Purchase Price': 'purchase_price',
      'Target Sale Price': 'target_sale_price',
      'Minimum Sale Price': 'minimum_sale_price',
      'Desired Profit': 'desired_profit',
      'Platform Fee': 'platform_fee',
      'Other Costs': 'other_costs',
      'Purchase Date': 'purchase_date',
      'Listing Date': 'listing_date',
      'Sale Date': 'sale_date',
      'Actual Sale Price': 'actual_sale_price',
      Status: 'status',
      'Days Listed': 'days_listed',
      'Profit at Target': 'profit_at_target',
      'Actual Profit': 'actual_profit',
      Description: 'description',
      Keywords: 'keywords',
      'Storage Location': 'storage_location',
      Source: 'source',
      'Vinted URL': 'vinted_url',
      Notes: 'notes',
      'Created At': 'created_at',
      'Updated At': 'updated_at'
    },
    conflict: 'item_id'
  },
  {
    file: 'Pictures.csv',
    table: 'pictures',
    map: {
      'Picture ID': 'picture_id',
      'Item ID': 'item_id',
      'Image URL': 'image_url',
      'Drive File ID': 'storage_path',
      Note: 'note',
      'Is Cover': 'is_cover',
      'Is Packaging Proof': 'is_packaging_proof',
      'Photo Type': 'photo_type',
      'Uploaded At': 'uploaded_at'
    },
    conflict: 'picture_id'
  },
  {
    file: 'Labels.csv',
    table: 'labels',
    map: {
      'Label ID': 'label_id',
      'Item ID': 'item_id',
      'File URL': 'file_url',
      'Drive File ID': 'storage_path',
      Note: 'note',
      'Uploaded At': 'uploaded_at'
    },
    conflict: 'label_id'
  },
  {
    file: 'AuditLog.csv',
    table: 'audit_log',
    map: {
      Timestamp: 'timestamp',
      'Item ID': 'item_id',
      Action: 'action',
      Field: 'field',
      'Old Value': 'old_value',
      'New Value': 'new_value',
      Note: 'note'
    }
  },
  {
    file: 'StatusLog.csv',
    table: 'status_log',
    map: {
      Timestamp: 'timestamp',
      'Item ID': 'item_id',
      'Old Status': 'old_status',
      'New Status': 'new_status',
      Note: 'note'
    }
  },
  {
    file: 'Settings.csv',
    table: 'settings',
    map: {
      Key: 'key',
      Value: 'value'
    },
    conflict: 'key'
  },
  {
    file: 'Sales.csv',
    table: 'sales',
    map: {
      'Item ID': 'item_id',
      'Actual Sale Price': 'actual_sale_price',
      'Sold At': 'sold_at',
      Note: 'note'
    }
  }
];

function cleanValue(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeDate(value, dateOnly = false) {
  const clean = cleanValue(value);
  if (clean === null) return null;

  const uk = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (uk) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = uk;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
  }

  const date = new Date(clean);
  if (Number.isNaN(date.valueOf())) return null;
  return dateOnly ? date.toISOString().slice(0, 10) : date.toISOString();
}

function coerceValue(column, value) {
  const clean = cleanValue(value);
  const isNumberColumn = column.includes('price') ||
    column.includes('profit') ||
    column.includes('cost') ||
    column === 'platform_fee' ||
    column === 'actual_sale_price';

  if (clean === null) {
    if (column.startsWith('is_')) return false;
    if (column.endsWith('_date') || column.endsWith('_at') || column === 'timestamp') return null;
    if (isNumberColumn || column === 'days_listed') return null;
    return '';
  }

  if (column.startsWith('is_')) return ['true', 'yes', '1'].includes(clean.toLowerCase());
  if (column.endsWith('_date')) return normalizeDate(clean, true);
  if (column.endsWith('_at') || column === 'timestamp') return normalizeDate(clean, false);
  if (isNumberColumn) {
    return Number(clean.replace(/[£,]/g, '')) || 0;
  }
  if (column === 'days_listed') return Number.parseInt(clean, 10) || null;
  return clean;
}

function mapRow(row, map) {
  const output = {};
  for (const [csvHeader, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(row, csvHeader)) {
      output[column] = coerceValue(column, row[csvHeader]);
    }
  }
  return output;
}

async function importJob(job) {
  const filePath = path.join(importDir, job.file);
  if (!existsSync(filePath)) {
    console.log(`Skipping ${job.file}: file not found.`);
    return;
  }

  const csv = await readFile(filePath, 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
  let mapped = rows.map(row => mapRow(row, job.map));
  if (!mapped.length) {
    console.log(`Skipping ${job.file}: no rows.`);
    return;
  }

  if (job.table !== 'inventory' && Object.values(job.map).includes('item_id')) {
    const { data, error } = await supabase.from('inventory').select('item_id');
    if (error) throw error;
    const inventoryIds = new Set((data || []).map(row => row.item_id));
    const before = mapped.length;
    mapped = mapped.filter(row => !row.item_id || inventoryIds.has(row.item_id));
    const skipped = before - mapped.length;
    if (skipped) console.log(`Skipping ${skipped} ${job.file} row(s): item_id not found in inventory.`);
  }

  if (!mapped.length) {
    console.log(`Skipping ${job.file}: no rows left after validation.`);
    return;
  }

  const query = supabase.from(job.table).upsert(mapped, job.conflict ? { onConflict: job.conflict } : undefined);
  const { error } = await query;
  if (error) throw new Error(`${job.file}: ${error.message}`);
  console.log(`Imported ${mapped.length} rows from ${job.file} into ${job.table}.`);
}

console.log(`Importing CSVs from ${importDir}`);
for (const job of csvJobs) {
  await importJob(job);
}
console.log('CSV import complete.');
