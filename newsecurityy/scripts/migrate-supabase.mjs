import { createClient } from '@supabase/supabase-js'

import fs from 'node:fs'

function readEnvFile(fileUrl) {
  if (!fs.existsSync(fileUrl)) return {}

  return fs.readFileSync(fileUrl, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return acc

      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) return acc

      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      acc[key] = value
      return acc
    }, {})
}

const fileEnv = readEnvFile(new URL('../.env', import.meta.url))
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const allowSameProject = args.has('--allow-same-project')

const oldUrl =
  process.env.OLD_SUPABASE_URL ||
  fileEnv.OLD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  fileEnv.SUPABASE_URL ||
  process.env.REACT_APP_SUPABASE_URL ||
  fileEnv.REACT_APP_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  fileEnv.VITE_SUPABASE_URL
const oldKey =
  process.env.OLD_SERVICE_ROLE_KEY ||
  fileEnv.OLD_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  fileEnv.SUPABASE_SERVICE_ROLE_KEY
const newUrl = process.env.NEW_SUPABASE_URL || fileEnv.NEW_SUPABASE_URL
const newKey = process.env.NEW_SERVICE_ROLE_KEY || fileEnv.NEW_SERVICE_ROLE_KEY

if (!oldUrl || !oldKey || !newUrl || !newKey) {
  console.error('Missing env vars. Required: source Supabase URL/service role key and NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (!allowSameProject && oldUrl === newUrl) {
  console.error('OLD_SUPABASE_URL and NEW_SUPABASE_URL point to the same project. Refusing to run. Use --allow-same-project only if this is intentional.')
  process.exit(1)
}

const oldClient = createClient(oldUrl, oldKey, { auth: { persistSession: false } })
const newClient = createClient(newUrl, newKey, { auth: { persistSession: false } })

const allowedColumns = [
  'id', 'created_at', 'exit_at', 'event_type', 'type', 'sub_category', 'shift',
  'plate', 'driver', 'name', 'host', 'note', 'location',
  'entry_location', 'exit_location',
  'seal_number', 'seal_number_entry', 'seal_number_exit',
  'tc_no', 'phone', 'user_email'
]

async function checkTable(client, label) {
  const { error } = await client.from('security_logs').select('id').limit(1)
  if (error) {
    console.error(`[${label}] security_logs check failed:`, error.message)
    process.exit(1)
  }
}

async function getCount(client, label) {
  const { count, error } = await client
    .from('security_logs')
    .select('id', { count: 'exact', head: true })

  if (error) {
    console.error(`[${label}] security_logs count failed:`, error.message)
    process.exit(1)
  }

  return count || 0
}

function cleanRow(row) {
  const obj = {}
  for (const key of allowedColumns) {
    if (row[key] !== undefined) obj[key] = row[key]
  }
  return obj
}

async function migrate() {
  await checkTable(oldClient, 'OLD')
  await checkTable(newClient, 'NEW')

  const sourceCount = await getCount(oldClient, 'OLD')
  const targetCountBefore = await getCount(newClient, 'NEW')

  console.log(`Source rows: ${sourceCount}`)
  console.log(`Target rows before: ${targetCountBefore}`)

  if (dryRun) {
    console.log('Dry run: no rows written.')
    return
  }

  const pageSize = 1000
  let offset = 0
  let totalFetched = 0
  let totalUpserted = 0

  while (true) {
    const { data, error } = await oldClient
      .from('security_logs')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('Fetch error:', error.message)
      process.exit(1)
    }

    if (!data || data.length === 0) break

    const cleaned = data.map(cleanRow)
    const { error: upsertError } = await newClient
      .from('security_logs')
      .upsert(cleaned, { onConflict: 'id', ignoreDuplicates: true })

    if (upsertError) {
      console.error('Upsert error:', upsertError.message)
      process.exit(1)
    }

    totalFetched += data.length
    totalUpserted += cleaned.length
    offset += pageSize
    console.log(`Migrated batch: ${data.length} (total fetched: ${totalFetched})`)
  }

  const targetCountAfter = await getCount(newClient, 'NEW')
  console.log(`Done. Fetched: ${totalFetched}, Upserted: ${totalUpserted}, Target rows after: ${targetCountAfter}`)
}

migrate().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
