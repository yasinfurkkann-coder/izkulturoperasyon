# AŞIK VEYSEL 2027 TAKVİMİ

Aşık Veysel'in 2027 etkinlik programını (konser, tiyatro, mezuniyet, kurulum) 10 kişilik ekip
ile ortak yönetmek için yapılan web sitesi. Takvim, liste/tablo ve muhasebe-rapor görünümleri;
damga vergisi, tahsilat ve fatura takibi; JSON yedek/geri yükleme, CSV dışa aktarma ve yazdırma
özellikleri içerir.

## Nasıl çalışır

- **Önyüz:** tek sayfalık statik uygulama (`public/index.html`, vanilla JS + Tailwind CDN).
  Tarayıcıda çalışır, veriyi önce `localStorage`'a yazar, sonra buluta senkronize eder.
- **Canlı senkronizasyon:** `cloud-sync.js`, `/api/state` uç noktasını kullanır. Her cihaz
  etkinlik listesi, damga vergisi oranı, yetkili kullanıcılar ve ekip notunu tek bir paylaşılan
  belgeye yazar; her cihaz 4 saniyede bir değişiklikleri kontrol eder.
- **Backend:** Netlify Server (`netlify/server/index.mjs`) `/api/state` için GET (oku) ve
  PUT (kısmi güncelle) desteği verir.
- **Veritabanı:** Netlify Database (yönetilen Postgres). Şema `netlify/database/migrations/`
  altındaki SQL migration ile oluşturulur; `team_state` tablosu tek satırlık paylaşılan belgeyi
  tutar.
- **PWA:** `manifest.webmanifest` ve `sw.js` ile telefona kurulabilir, çevrimdışı açılır.

## Yerelde çalıştırma

```bash
npm install
netlify dev --port 8889
```

Sonra `http://localhost:8889` adresini açın. Yönetici varsayılan şifresi uygulamada tanımlıdır
(`DEFAULT_ADMIN_PASS`, `index.html`).
