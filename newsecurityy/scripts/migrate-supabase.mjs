import { createClient } from '@supabase/supabase-js'

const oldUrl = process.env.OLD_SUPABASE_URL
const oldKey = process.env.OLD_SERVICE_ROLE_KEY
const newUrl = process.env.NEW_SUPABASE_URL
const newKey = process.env.NEW_SERVICE_ROLE_KEY

if (!oldUrl || !oldKey || !newUrl || !newKey) {
  console.error('Missing env vars. Required: OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY')
  process.exit(1)
}

const oldClient = createClient(oldUrl, oldKey, { auth: { persistSession: false } })
const newClient = createClient(newUrl, newKey, { auth: { persistSession: false } })

const allowedColumns = [
  'id', 'created_at', 'exit_at', 'type', 'sub_category', 'shift',
  'plate', 'driver', 'name', 'host', 'note', 'location',
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

  const pageSize = 1000
  let offset = 0
  let totalFetched = 0
  let totalUpserted = 0

  while (true) {
    const { data, error } = await oldClient
      .from('security_logs')
      .select('*')
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

  console.log(`Done. Fetched: ${totalFetched}, Upserted: ${totalUpserted}`)
}

migrate().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
