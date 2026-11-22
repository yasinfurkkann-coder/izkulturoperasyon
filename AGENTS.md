# AGENTS.md

## Proje

"AŞIK VEYSEL 2027 TAKVİMİ" — Türkçe, tek sayfalık statik etkinlik/muhasebe uygulaması + Netlify
senkron backend. Yayınlama dizini `public/` (`netlify.toml` içinde `publish = "public"`); statik
uygulama dosyaları burada, backend `netlify/` altında.

## Mimari

- `index.html` — uygulamanın tamamı: markup + ~2000 satır vanilla JS (inline script). Veri modeli
  `RAW_EVENTS`/`EVENTS` sabitlerinde; kullanıcı değişiklikleri `localStorage` anahtarlarına
  (`asik_veysel_2027_*`) yazılır.
- `cloud-sync.js` — ES modülü; `window.saveEventsToStorage`, `window.saveStampRateToStorage` ve
  `window.__syncAccessConfigToCloud` fonksiyonlarını sarmalayıp `/api/state`'e değişiklikleri
  debounced PUT ile gönderir, 4 saniyelik poll ile uzak değişiklikleri `applyRemote()` ile uygular.
  Uygulamanın global değişkenlerine (`currentEvents`, `stampDutyRatePermille`, `managedUsers`,
  `currentActor`, `lastGlobalEditor`, `hydrateEvent`, `renderApp`, `canEditSchedule`,
  `STORAGE_USERS_KEY`) dayanır — inline scriptteki bu isimleri değiştirirsen burayı da güncelle.
- `netlify/server/index.mjs` — tek entrypoint Netlify Server. Yalnız `/api/state` (GET oku,
  PUT kısmi güncelle, `config.path = '/api/*'`). Depoda başka backend yok.
- `netlify/database/migrations/` — `team_state` tablosu (tek satır paylaşılan belge:
  events_json, stamp_rate, users_json, note_text, updated_by, updated_at_ms). Native
  `@netlify/database` sürücüsü kullanılıyor; Drizzle yok.
- `sw.js`, `manifest.webmanifest`, `icon-*.png` — PWA katmanı.

## Kurallar / dikkat

- Etkinlik tarihleri 2027; tarih formatı `DD.MM.YYYY`, ISO anahtarlar `YYYY-MM-DD`.
- Event JSON payload'ı bilinçli olarak küçültülmüştür: PDF dosya içerikleri IndexedDB'de cihazda
  kalır, buluta yalnızca metadata gider. Bunu değiştirme.
- Senkronizasyon parça parçadır (events / stamp / users / note) ve last-write-wins; revizyon
  `updated_at_ms` GREATEST ile korunur, kendi yazısının echo'sunu `lastRevision` ile atlar.
- Yönetici şifresi ve roller istemci tarafındadır (orijinal uygulamayla aynı); sunucu tarafı auth
  yok.
- Yeni şema değişikliği = `netlify/database/migrations/` altına yeni SQL migration dosyası.
