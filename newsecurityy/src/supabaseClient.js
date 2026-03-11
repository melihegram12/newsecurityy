import { createClient } from '@supabase/supabase-js'

// Supabase konfigürasyonu (CRA: REACT_APP_, Vite: VITE_)
// NOT: Gerçek anahtarları repo içine gömmeyin. `.env` / deploy env kullanın.
const fallbackUrl = 'http://localhost:54321'
const fallbackKey = 'test-anon-key'

const supabaseUrl =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  fallbackUrl

const supabaseKey =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  fallbackKey

if (supabaseUrl === fallbackUrl || supabaseKey === fallbackKey) {
  // Test ve yanlış konfigürasyon durumunda sessizce fallback'e düşer.
  // Prod ortamında `.env` ile mutlaka override edin.
  console.warn('[supabase] Missing env vars; using fallback URL/key')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
export { supabaseUrl }
