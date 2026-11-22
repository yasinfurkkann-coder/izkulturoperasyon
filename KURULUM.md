# Aşık Veysel 2027 Takvimi — Çoklu Cihaz / Canlı Kurulum

Amaç: Birden fazla bilgisayar ve telefon aynı anda aynı takvimi görsün; biri değişiklik yapınca diğerlerinde anında güncellensin.
İki ücretsiz adım: (A) Firebase veritabanı, (B) Web'e yayınlama.

## A) Firebase (ücretsiz) — yaklaşık 5 dakika
1. https://console.firebase.google.com adresine Google hesabınızla girin → **Proje ekle** → bir ad verin (Analytics'i kapatabilirsiniz).
2. Sol menü **Derleme (Build) → Firestore Database → Veritabanı oluştur**. Konum olarak `eur3 (europe-west)` seçin, **Üretim modunda** başlatın.
3. Firestore'da **Kurallar (Rules)** sekmesine gidin, içeriği aşağıdakiyle değiştirip **Yayınla** deyin:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /takvim/2027 {
      allow read, write: if true;
    }
    match /takvim_dosyalar/{dosya} {
      allow read, write: if true;
    }
  }
}
```
4. Proje ayarları (⚙️) → **Genel** → "Uygulamalarınız" → **Web (</>)** simgesi → uygulamaya bir ad verin → size `firebaseConfig = { ... }` gösterilir.
5. Bu değerleri `firebase-config.js` dosyasındaki yerlere yapıştırın (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

## B) Web'e yayınlama — yaklaşık 2 dakika
1. Bu klasörü olduğu gibi (index.html, firebase-config.js, cloud-sync.js, sw.js, manifest, ikonlar) https://app.netlify.com/drop sayfasına sürükleyin.
2. Verilen `https://....netlify.app` adresini ekibe gönderin. Herkes aynı adresi açar.
3. İsterseniz telefonda "Ana Ekrana Ekle", bilgisayarda Chrome'da "Yükle" ile uygulama gibi kullanın.

Sağ üstteki rozet **"Canlı Senkron Aktif"** yazıyorsa bağlantı çalışıyordur.

## Nasıl çalışır / sınırlar
- Etkinlikler, damga vergisi oranı, ekip notu ve kullanıcı listesi tüm cihazlarda ortaktır.
- İki kişi **aynı anda aynı kaydı** düzenlerse son kaydeden kazanır.
- İnternet kesilirse uygulama çalışmaya devam eder, bağlantı gelince değişiklikler eşitlenir.
- **Muhasebe fatura PDF'leri** eşitlenmez; yükleyen cihazda saklanır.
- **Operasyon dosyalarındaki sözleşme (PDF) ve fotoğraflar (JPEG)** Firestore içinde parçalı saklanarak tüm cihazlara eşitlenir (ek ücret/kart gerekmez). PDF başına 8 MB sınırı vardır; fotoğraflar otomatik küçültülür. Spark planın 1 GB depolama sınırı dolarsa dosya yüklemesi durur.

## Güvenlik uyarısı
- Giriş kodları ve yönetici şifresi (`yonetici2027`) sayfa kodunda/veritabanında açıktır; adresi ve ayarları bilen biri veriyi okuyup değiştirebilir. Adresi sadece ekiple paylaşın ve yönetici şifresini `index.html` içinde (`DEFAULT_ADMIN_PASS`) değiştirin.
- Gerçek güvenlik için Firebase Authentication (e-posta/şifre ile giriş) ve ona bağlı kurallar eklenmelidir.
