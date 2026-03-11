# NewSecurityy Guvenlik Paneli

Bu repo iki parcadan olusur:

- `src/` + `electron/`: mevcut React/Electron istemcisi (legacy). Su an Supabase ile calisiyor.
- `backend/`: hedeflenen yeni backend (Django + DRF + PostgreSQL). Supabase kullanilmiyor.

## Supabase Kurulum (Istemci)

1. Supabase SQL Editor'da `migration_script.sql` dosyasini calistirin.
2. RLS politikalarini bu script olusturur. (Anon erisim aciktir; daha guvenli isterseniz `public` yerine `authenticated` kullanin.)
3. `.env.example` -> `.env` yapin ve `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` degerlerini girin.

Notlar:
- `migration_script.sql` su an `event_type` kolonunu da ekler (yerel SQLite + Django ile uyum icin). Daha once eski scripti calistirdiysaniz tekrar calistirabilirsiniz.
- SMTP / e-posta bilgileri artik repoya gomulu degil; Electron icinde `Dashboard -> Sync -> E-posta (SMTP)` alanindan ayarlanir (veya `SMTP_*` env ile).

Not: Electron uygulamasi Supabase'den periyodik olarak veri cekip lokal SQLite'a yazar.

## Lokal API Sync (Supabase + Yerel Sunucu)

Uygulama Supabase'e ek olarak yerel Django API'ye de kayit atabilir.

Frontend env (build zamaninda):
- `REACT_APP_LOCAL_API_URL=http://localhost:8000/api`
- `REACT_APP_LOCAL_API_KEY=` (opsiyonel)

Uygulama icinden "Yerel Sunucu Sync" bolumunden adres/key guncellenebilir (localStorage).

Mobil (lokal ag):
- `REACT_APP_LOCAL_API_URL` degerini bilgisayar IP'si olacak sekilde ayarlayin.
  Ornek: `http://192.168.1.10:8000/api`

Not: Yerel API offline olursa kayitlar kuyruga alinip daha sonra gonderilir.

## Backend (Django + PostgreSQL)

Backend dokumani: `backend/README.md`

## Rol Bazli Giris (Web/EXE)

Uygulama acildiginda rol secimli login ekrani gelir:

- `Güvenlik Personeli` -> operasyon ekranlari
- `İnsan Kaynakları` -> HR ekranlari
- `Geliştirici` -> tum ekranlar + audit ekrani

Varsayilan test kullanicilari:

- `Güvenlik Personeli` (alias) veya `güvenlik_personeli` / `Security123!`
- `İnsan Kaynakları` (alias) veya `insan_kaynakları` / `Hr123456!`
- `Geliştirici` (alias) veya `geliştirici` / `Dev123456!`

Olusturmak/sifirlamak icin:

- `docker compose exec api python manage.py bootstrap_users --reset-passwords`

## API Business Mapping (Otomatik Dokumantasyon)

Repo icindeki tum REST/GraphQL/WebSocket/gRPC endpoint'lerini ve frontend tarafindaki kullanim yerlerini statik olarak tarayip dokuman/CSV/mermaid ciktilari uretir:

- Calistirma: `python scripts/api_business_mapper.py --root . --out docs/api-business-mapping --exclude it-envanter-sistemi-main`
- Ciktilar: `docs/api-business-mapping/`

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
