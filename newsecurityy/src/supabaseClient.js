import { createClient } from '@supabase/supabase-js'

// Supabase konfigürasyonu (CRA: REACT_APP_, Vite: VITE_)
// NOT: Gerçek anahtarları repo içine gömmeyin. `.env` / deploy env kullanın.
const fallbackUrl = 'http://localhost:54321'
const fallbackKey = 'test-anon-key'
const env = {
  ...((typeof process !== 'undefined' && process.env) ? process.env : {}),
  ...(import.meta.env || {}),
}

const supabaseUrl =
  env.REACT_APP_SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  fallbackUrl

const supabaseKey =
  env.REACT_APP_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  fallbackKey

if (supabaseUrl === fallbackUrl || supabaseKey === fallbackKey) {
  // Test ve yanlış konfigürasyon durumunda sessizce fallback'e düşer.
  // Prod ortamında `.env` ile mutlaka override edin.
  console.warn('[supabase] Missing env vars; using fallback URL/key')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
export { supabaseUrl }
