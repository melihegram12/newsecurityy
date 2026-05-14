#!/usr/bin/env node
/**
 * Local SQLite -> Supabase aktarim scripti.
 *
 * Kullanim:
 *   node scripts/push-local-sqlite-to-supabase.js [db-path] [--dry-run]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_DB_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'newsecurityy',
  'security_panel.db'
);

const COLUMNS = [
  'event_type',
  'type',
  'sub_category',
  'shift',
  'plate',
  'driver',
  'name',
  'host',
  'note',
  'location',
  'entry_location',
  'exit_location',
  'seal_number',
  'seal_number_entry',
  'seal_number_exit',
  'tc_no',
  'phone',
  'user_email',
  'created_at',
  'exit_at',
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return acc;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      acc[key] = value;
      return acc;
    }, {});
}

function getConfig() {
  const fileEnv = readEnvFile(path.join(__dirname, '..', '.env'));
  const supabaseUrl = (
    process.env.NEW_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    fileEnv.NEW_SUPABASE_URL ||
    fileEnv.SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    fileEnv.REACT_APP_SUPABASE_URL ||
    fileEnv.VITE_SUPABASE_URL ||
    ''
  ).trim();
  const supabaseKey = (
    process.env.NEW_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    fileEnv.NEW_SERVICE_ROLE_KEY ||
    fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL or service-role key in .env');
  }

  return { supabaseUrl, supabaseKey };
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

function rowToObject(columns, values) {
  const row = {};
  columns.forEach((column, index) => {
    row[column] = values[index];
  });
  return row;
}

function cleanPayload(row) {
  const payload = {};
  COLUMNS.forEach((column) => {
    if (!(column in row)) return;

    let value = row[column];
    if (value === '') value = null;
    if (column === 'created_at' || column === 'exit_at') {
      value = normalizeDate(value);
    }
    payload[column] = value;
  });

  if (!payload.created_at) return null;
  return payload;
}

function chunked(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function readLocalRows(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Local DB not found: ${dbPath}`);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const result = db.exec(`SELECT ${COLUMNS.join(', ')} FROM security_logs ORDER BY created_at ASC`);
  if (!result.length) return [];

  const { columns, values } = result[0];
  return values
    .map((valueSet) => cleanPayload(rowToObject(columns, valueSet)))
    .filter(Boolean);
}

async function getRemoteCount(supabase) {
  const { count, error } = await supabase
    .from('security_logs')
    .select('created_at', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dbPathArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const dbPath = dbPathArg ? path.resolve(dbPathArg) : DEFAULT_DB_PATH;
  const { supabaseUrl, supabaseKey } = getConfig();
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await readLocalRows(dbPath);
  const beforeCount = await getRemoteCount(supabase);

  console.log(`Local DB: ${dbPath}`);
  console.log(`Local rows: ${rows.length}`);
  console.log(`Supabase rows before: ${beforeCount}`);

  if (dryRun) {
    console.log('Dry run: no rows uploaded.');
    return;
  }

  let uploaded = 0;
  const batches = chunked(rows, 200);
  for (const [index, batch] of batches.entries()) {
    const { error } = await supabase
      .from('security_logs')
      .upsert(batch, { onConflict: 'created_at' });

    if (error) {
      throw new Error(`Batch ${index + 1}/${batches.length} failed: ${error.message}`);
    }

    uploaded += batch.length;
    process.stdout.write(`Uploaded ${uploaded}/${rows.length}\r`);
  }

  const afterCount = await getRemoteCount(supabase);
  console.log(`\nSupabase rows after: ${afterCount}`);
  console.log(`Uploaded/upserted: ${uploaded}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
