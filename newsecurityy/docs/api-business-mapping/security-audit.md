# Security Audit Report (Static)

## Findings
- `.env` exists: `.env` (ensure not committed)
- Django CORS allows all origins in DEBUG; restrict in production.
- Django SECRET_KEY fallback is insecure; must be set in production env.
- `/api/logs/sync` supports optional `X-Api-Key`; consider requiring it in production.
- Supabase RLS script uses `TO public` policies (anon access). Review and restrict.

## Recommendations
- Add secret scanning and rotate keys that were ever committed.
- Apply least privilege for Supabase RLS and local sync endpoint.
- Prefer explicit CORS allow-lists and add rate limiting for public endpoints.
