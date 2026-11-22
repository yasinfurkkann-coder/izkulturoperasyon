# AGENTS.md

## Proje

"AŞIK VEYSEL 2027 TAKVİMİ" — Türkçe, tek sayfalık statik etkinlik/muhasebe uygulaması. Yayınlama
dizini `public/` (`netlify.toml` içinde `publish = "public"`). Kullanıcının yüklediği paketle
(2026-11-22) senkron katmanı Netlify backend'den **Firebase Firestore**'a taşındı; çok yıllı
takvim desteği eklendi.

## Mimari

- `public/index.html` — uygulamanın çekirdeği: markup + inline vanilla JS. Veri modeli
  `RAW_EVENTS`/`EVENTS` sabitlerinde; kullanıcı değişiklikleri `localStorage` anahtarlarına
  (`asik_veysel_2027_*`) yazılır. Çok yıllı destek: `state.year` ('all' veya yıl) /
  `state.currentYear`.
- `public/cloud-sync.js` — ES modülü; Firebase Firestore (SDK CDN'den dinamik import) üzerinden
  tek belge (`takvim/2027`) ile canlı senkron (`onSnapshot`). Operasyon dosyaları (sözleşme PDF /
  fotoğraf) `takvim_dosyalar` koleksiyonunda 700 KB'lık base64 parçalar halinde saklanır.
  `firebase-config.js` boş/placeholder ise "Yerel Mod"da çalışır. Uygulamanın global
  değişkenlerine (`currentEvents`, `stampDutyRatePermille`, `managedUsers`, `currentActor`,
  `lastGlobalEditor`, `hydrateEvent`, `renderApp`, `canEditSchedule`, `STORAGE_USERS_KEY`)
  dayanır — inline scriptteki bu isimleri değiştirirsen burayı da güncelle.
- `public/firebase-config.js` — Firebase web config placeholder'ları; gerçek değerler kullanıcı
  tarafından yapıştırılır (bkz. `KURULUM.md`).
- `public/operasyon.js` — operasyon dosyaları modülü (sözleşme PDF/fotoğraf yükleme, Firestore
  chunk senkronu ile eşleşir).
- `public/excel-tools.js` — Excel (.xlsx) içe/dışa aktarma; `exportXlsxBtn`, `importXlsxBtn`,
  `exportReportXlsxBtn`, `mobileExportXlsxBtn`, `mobileImportXlsxBtn` düğmelerini bağlar,
  `window.__excelTools`'ı dışa açar.
- `netlify/server/index.mjs` + `netlify/database/migrations/` — eski `/api/state` backend'i.
  Firebase sürümüyle front-end bunu kullanmıyor; geri dönük uyumluluk için duruyor, silme.
- `sw.js`, `manifest.webmanifest`, `icon-*.png` — PWA katmanı; `sw.js` CORE listesi tüm yerel
  scriptleri içerir (firebase-config.js dahil), cache sürümü `av2027-v7`.

## Kurallar / dikkat

- Tarih formatı `DD.MM.YYYY`, ISO anahtarlar `YYYY-MM-DD`; takvim artık 2027+ yılları
  destekliyor (yıl seçici).
- Event JSON payload'ı bilinçli olarak küçültülmüştür: PDF dosya içerikleri Firestore
  `takvim_dosyalar` koleksiyonuna parçalı gider; muhasebe fatura PDF'leri yalnızca yükleyen
  cihazda kalır. Bunu değiştirme.
- Senkronizasyon last-write-wins; iki cihaz aynı kaydı aynı anda düzenlerse son kaydeden kazanır.
- Yönetici şifresi ve roller istemci tarafındadır (`DEFAULT_ADMIN_PASS` = `yonetici2027`); sunucu
  tarafı auth yok. Firestore kuralları da açık (allow read, write: if true) — `KURULUM.md`'deki
  güvenlik uyarısına bak.
- Dışa aktarma biçimleri: CSV, Excel (.xlsx), JSON yedek ve ICS (iCalendar, "Takvime Ekle").
  ICS üretimi RFC 5545 uyumlu (CRLF, kaçış, 75-bayt satır katlama, DTEND = DTSTART+1 gün).
