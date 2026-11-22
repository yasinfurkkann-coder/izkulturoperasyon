# AŞIK VEYSEL 2027 TAKVİMİ

Aşık Veysel'in 2027 etkinlik programını (konser, tiyatro, mezuniyet, kurulum) 10 kişilik ekip
ile ortak yönetmek için yapılan web sitesi. Takvim, liste/tablo ve muhasebe-rapor görünümleri;
damga vergisi, tahsilat ve fatura takibi; JSON yedek/geri yükleme, CSV dışa aktarma ve yazdırma
özellikleri içerir.

## Nasıl çalışır

- **Önyüz:** tek sayfalık statik uygulama (`public/index.html`, vanilla JS + Tailwind CDN).
  Tarayıcıda çalışır, veriyi önce `localStorage`'a yazar, sonra buluta senkronize eder.
  Çok yıllı takvim desteği vardır (2027+).
- **Canlı senkronizasyon:** `cloud-sync.js`, Firebase Firestore üzerinden tek belge
  (`takvim/2027`) ile canlı senkron yapar (`onSnapshot`). Operasyon dosyalarındaki sözleşme
  PDF/fotoğraflar `takvim_dosyalar` koleksiyonunda parçalı saklanır. `firebase-config.js`
  boşsa uygulama "Yerel Mod"da çalışır.
- **Excel entegrasyonu:** `excel-tools.js` ile .xlsx içe/dışa aktarma; `operasyon.js` ile
  operasyon dosyası yükleme.
- **Backend:** kullanılmıyor; eski `/api/state` Netlify backend'i (`netlify/`) geri dönük
  uyumluluk için duruyor.
- **PWA:** `manifest.webmanifest` ve `sw.js` ile telefona kurulabilir, çevrimdışı açılır.

## Firebase kurulumu

Çoklu cihaz canlı senkron için Firebase Firestore kurulum adımları `KURULUM.md` dosyasında.
`firebase-config.js` içindeki placeholder değerler Firebase konsolundan alınan gerçek değerlerle
değiştirilir.

## Yerelde çalıştırma

```bash
npm install
netlify dev --port 8889
```

Sonra `http://localhost:8889` adresini açın. Yönetici varsayılan şifresi uygulamada tanımlıdır
(`DEFAULT_ADMIN_PASS`, `index.html`).
