# Backend (Django + DRF)

Bu dizin, Supabase olmadan calisan backend API'yi barindirir.

## Calistirma (Docker ile)

1) `docker compose up -d --build`
2) Migration:
   - `docker compose exec api python manage.py migrate`
3) Varsayilan roller + kullanicilar:
   - `docker compose exec api python manage.py bootstrap_users --reset-passwords`
4) Admin user (opsiyonel):
   - `docker compose exec api python manage.py createsuperuser`
5) Ornek kiosk cihazi olustur:
   - `docker compose exec api python manage.py bootstrap_device --site "Tesis" --gate "Ana Kapi" --gate-code "ana-kapi" --device-id "KIOSK-1" --device-name "Kiosk 1"`

API: `http://localhost:8000`

## Auth

- Rol bazli panel girisi:
  - `POST /api/auth/login`
    - body: `{ "username": "...", "password": "...", "role": "SECURITY|HR|DEVELOPER" }`
  - `GET /api/auth/me?role=SECURITY|HR|DEVELOPER`
  - `GET /api/auth/audit?limit=200` (sadece `DEVELOPER` ve `ADMIN`)

- SimpleJWT endpointleri (opsiyonel / legacy):
  - `POST /api/auth/token/`
  - `POST /api/auth/token/refresh/`

- Kiosk: Device Token
  - `POST /api/device/auth` -> token uretir
  - `POST /api/check` -> IN/OUT event olusturur

### Varsayilan kullanicilar

- `Güvenlik Personeli` (alias) veya `güvenlik_personeli` / `Security123!` -> `SECURITY`
- `İnsan Kaynakları` (alias) veya `insan_kaynakları` / `Hr123456!` -> `HR`
- `Geliştirici` (alias) veya `geliştirici` / `Dev123456!` -> `DEVELOPER`

Sifreleri ortam degiskeni ile override edebilirsiniz:

- `APP_SECURITY_PASSWORD`
- `APP_HR_PASSWORD`
- `APP_DEVELOPER_PASSWORD`

### POST /api/device/auth

Request:
```json
{ "device_id": "KIOSK-1", "device_key": "..." }
```

Response:
```json
{ "token": "...", "expires_at": "2026-02-03T12:00:00Z", "device": { "device_id": "KIOSK-1" } }
```

### POST /api/check

Header:
- `Authorization: Device <token>`

Request:
```json
{
  "client_event_uuid": "6a2f90a1-5f7c-4a58-8e28-5e5ac4c40b47",
  "direction": "IN",
  "badge_code": "CARD-0001",
  "person": { "kind": "employee", "full_name": "Ali Veli", "tc_no": "", "phone": "" }
}
```

Kurallar:
- Kisi icerideyken tekrar IN -> `ALREADY_INSIDE`
- Kisi iceride degilken OUT -> `NOT_INSIDE`
- `client_event_uuid` unique (idempotent)

## Lokal Log Sync (Supabase ile paralel)

Frontend, Supabase'e ek olarak bu endpoint'e de kayit gonderebilir.

- `POST /api/logs/sync`
- Body:
```json
{ "action": "INSERT|UPDATE|DELETE|EXIT", "data": { ... }, "local_id": "2026-02-04T10:00:00.000Z" }
```

`GET /api/logs` ve `POST /api/logs/sync` yetkileri:

- JWT ile:
  - `GET /api/logs`: `SECURITY`, `HR`, `DEVELOPER`, `ADMIN`
  - `POST /api/logs/sync`: `SECURITY`, `DEVELOPER`, `ADMIN`
- JWT yoksa:
  - `LOCAL_SYNC_API_KEY` aktifse header `X-Api-Key` zorunludur.

## Devamsızlık Modülü (Temel)

Yeni devamsızlık/izin kayıtları için API uçları:

- `GET /api/absence/types` (opsiyonel `?active=1`)
- `POST /api/absence/types`
- `GET /api/absence/types/<uuid>`
- `PATCH /api/absence/types/<uuid>`
- `GET /api/absence/records` (opsiyonel filtreler: `person_id`, `absence_type_id`, `absence_type_code`, `status`, `date_from`, `date_to`)
- `POST /api/absence/records`
- `GET /api/absence/records/<uuid>`
- `PATCH /api/absence/records/<uuid>`

Varsayılan devamsızlık türleri için:

```
python manage.py seed_absence_types
```

Not: Türlerin bordro/SGK/ücret vb. bayrakları varsayılan olarak gelir; işletme kurallarınıza göre admin panelden güncelleyiniz.

### Onay & Yetkilendirme (Temel)

Rol seed:

```
python manage.py seed_roles
```

Onay akışı uçları:

- `POST /api/absence/records/<uuid>/approve/manager`
- `POST /api/absence/records/<uuid>/approve/hr`
- `POST /api/absence/records/<uuid>/reject` (body: `{"note": "..."}`)
- `POST /api/absence/records/<uuid>/cancel` (body: `{"note": "..."}`)

Notlar:
- Geriye dönük kayıt (start_at < bugün) sadece **HR/ADMIN** rollerine açıktır.
- HR onayı için (ADMIN hariç) önce amir onayı gerekir.
- Roller, Django Admin üzerinden `UserRole` tablosundan kullanıcıya atanır.

## Puantaj & Zaman Yönetimi (Temel)

Vardiya tanımı:
- `GET /api/shifts` (opsiyonel `?active=1`)
- `POST /api/shifts`
- `GET /api/shifts/<uuid>`
- `PATCH /api/shifts/<uuid>`

Vardiya ataması:
- `GET /api/shift-assignments` (filtre: `person_id`, `shift_id`, `active=1`)
- `POST /api/shift-assignments`
- `GET /api/shift-assignments/<uuid>`
- `PATCH /api/shift-assignments/<uuid>`

Puantaj özeti:
- `GET /api/attendance/summary?person_id=<uuid>&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`

Notlar:
- Puantaj hesabı `AccessEvent` (IN/OUT) kayıtlarına göre yapılır.
- Geç kalma/erken çıkma toleransları vardiya üzerinde tanımlanır.

## Bordro & SGK (Temel)

Payroll profil:
- `GET /api/payroll/profiles` (opsiyonel `person_id`, `active=1`)
- `POST /api/payroll/profiles`
- `GET /api/payroll/profiles/<uuid>`
- `PATCH /api/payroll/profiles/<uuid>`

Payroll özeti:
- `GET /api/payroll/summary?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&person_id=<uuid>`

SGK raporu:
- `GET /api/sgk/report?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`

Notlar:
- Payroll özeti devamsızlık kayıtları (`AbsenceRecord`) üzerinden hesaplanır.
- Ücret/prim kesintisi için `PayrollProfile` içindeki oranlar kullanılır.
