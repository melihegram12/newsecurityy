# API Call Flows (Mermaid)

## Local-first (example)
```mermaid
sequenceDiagram
  participant UI as UI
  participant IPC as Local IPC
  participant DB as Local DB
  participant Remote as Remote API
  participant Local as Local API
  UI->>IPC: write/read
  IPC->>DB: persist
  UI-->>Remote: background sync
  UI-->>Local: background sync
```

## Auto-generated endpoint flows (top used)
### EXTERNAL SELECT /rest/v1/security_logs
- Call sites: src/App.jsx, src/dbClient.js
```mermaid
sequenceDiagram
  participant Client as Client
  participant API as Supabase(PostgREST)
  Client->>API: SELECT /rest/v1/security_logs
  API-->>Client: response
```

### REST POST /api/logs/sync
- Call sites: src/dbClient.js
```mermaid
sequenceDiagram
  participant Client as Client
  participant API as backend(django)
  Client->>API: POST /api/logs/sync
  API-->>Client: response
```
