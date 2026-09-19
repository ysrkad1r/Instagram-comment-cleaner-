# 🧹 IG Yorum Temizleyici

Instagram'da yıllar içinde yaptığın yüzlerce hatta binlerce yorumu tek tek silmek yerine, **kendi hesabındaki geçmiş yorumları** kontrollü, güvenli ve otomatik bir şekilde toplu olarak temizlemeni sağlayan açık kaynaklı bir Tampermonkey userscript'idir.

Instagram'ın kendi web arayüzü üzerinde çalışır; şifre, API token'ı veya üçüncü taraf hesap izinlerine kesinlikle ihtiyaç duymaz. Tüm işlemler doğrudan tarayıcında, senin açık olan oturumun üzerinden yürütülür.

![durum](https://img.shields.io/badge/durum-aktif-brightgreen) ![tampermonkey](https://img.shields.io/badge/gerekli-Tampermonkey-1e90ff) ![lisans](https://img.shields.io/badge/lisans-MIT-lightgrey)

---

<p align="center">
  <img src="./assets/panel.png" alt="IG Yorum Temizleyici Kontrol Paneli" width="380">
</p>

---

## 🔒 Neden Güvenli?

* **Sıfır Yetki:** Kullanıcı adı/şifre istemez, üçüncü parti sunuculara hiçbir veri göndermez.
* **Yerel Oturum:** Yalnızca tarayıcında açık olan aktif Instagram sekmesinde çalışır.
* **Şeffaf Kaynak Kodu:** Kod tamamen açıktır; DOM hareketleri ve tıklama eventleri dışında hiçbir harici ağ isteği barındırmaz.

---

## ✨ Temel Özellikler

* **Dinamik Batching (Paketli Silme):** Instagram'ın arayüzünü kilitlememek ve rate limit sınırlarına takılmamak için yorumları belirlediğin rastgele aralıklarda (örn. 10–20 adet) parçalayarak siler.
* **Kullanıcı Arayüzü (UI Paneli):** F12 Developer Tools veya konsola gerek kalmadan doğrudan sayfa üzerindeki modern, sürüklenebilir ve küçültülebilir panel üzerinden yönetilir.
* **Hata Kurtarma (Crash Recovery):** Sayfa donması, ağ kopması veya pop-up gecikmesi gibi durumlarda hatayı loglar, sayfayı otomatik yeniler ve toplam silinen sayısını unutmadan kaldığı yerden devam eder.
* **Anti-Bot Davranış Simülasyonu:** Tıklamalar ve bekleme süreleri arasına rastgele jitter (gecikme) ekleyerek robotik kalıpları engeller.
* **Kalıcı Bellek (Local State):** Panel ayarların `localStorage`'da saklanır; tarayıcı kapansa bile yapılandırman korunur.

---

## 🛠️ Teknik Çalışma Mimarisi

1. **DOM & Hedefleme:** Belirtilen kullanıcı adına ait yorum satırlarını bularak onay kutularını hesaplar.
2. **Pointer/Mouse Emülasyonu:** Instagram'ın modern React mimarisini tetiklemek için koordinat bazlı sentetik tıklama (`PointerEvent`, `MouseEvent`) dizileri çalıştırır.
3. **Akıllı Popup Algılama:** Sayfanın altındaki tetikleyici buton ile onay modalındaki spesifik onay butonunu (`_a9_1` sınıfı) ayırt ederek yanlış tıklamaları (örneğin "İptal" butonuna basılmasını) engeller.

---

## 📦 Gereksinimler

* Chromium tabanlı (Chrome, Brave, Edge, Opera) veya Firefox tabanlı bir modern web tarayıcısı.
* [Tampermonkey](https://www.tampermonkey.net/) tarayıcı uzantısı (ücretsiz).
* Instagram web arayüz dilinin **Türkçe** olması önerilir (buton seçicileri arayüz metinleriyle eşleştirilir).

---

## 🚀 Kurulum

1. Tarayıcına **Tampermonkey** eklentisini kur.
2. Eklenti ikonuna tıkla ve **Create a new script (Yeni script oluştur)** seçeneğini seç.
3. Editördeki şablon kodu tamamen sil.
4. Bu repoda bulunan [`ig-yorum-temizleyici.user.js`](./ig-yorum-temizleyici.user.js) dosyasının içeriğini kopyala ve editöre yapıştır.
5. `Ctrl + S` (macOS: `Cmd + S`) tuşlarına basarak kaydet.
6. [instagram.com](https://www.instagram.com) adresine git ve şu sekmeyi aç:  
   **Profilin → Hareketlerin → Yorumlar** (`instagram.com/your_activity/interactions/comments`)
7. Kontrol paneli sayfanın sağ alt köşesinde otomatik olarak belirecektir.

---

## ▶️ Kullanım Adımları

1. **Hareketlerin → Yorumlar** sayfasında olduğundan emin ol.
2. Panel üzerindeki **Kullanıcı adı** alanına kendi Instagram kullanıcı adını yaz.
3. İhtiyacına göre paket (batch) boyutlarını ve gecikme sürelerini düzenle.
4. **Başlat** butonuna bas.
5. Script sırasıyla paket seçimini yapacak, alttaki sil butonunu tetikleyecek, onay kutusunu onaylayacak ve bir sonraki tura geçecektir.
6. İşlemi durdurmak istediğinde dilediğin an **Durdur** butonuna tıklayabilirsin.

---

## ⚙️ Panel Parametreleri

| Parametre | Açıklama | Varsayılan Değer |
|---|---|---|
| **Kullanıcı adı** | Yorumları taranacak hesabın kullanıcı adı | `kullanici_adiniz` |
| **Batch (min-max)** | Her silme döngüsünde seçilecek rastgele yorum adedi aralığı | `10` – `20` |
| **Seçim gecikmesi ms** | Yorum kutucukları seçilirken tıklamalar arasındaki bekleme | `500` – `1000` ms |
| **Silme sonrası mola ms** | Bir paket silindikten sonra yeni pakete geçmeden önceki bekleme | `4000` – `7000` ms |
| **Otomatik kurtarma** | DOM hatasında veya takılmada sayfayı yenileyip devam etme seçeneği | `Açık` |

---

## ❗ Sorumluluk Reddi ve Önemli Notlar

* Bu script sadece **kendi hesabınıza ait yorumları toplu silebilmeniz** için geliştirilmiş bağımsız bir açık kaynak aracıdır.
* Instagram/Meta platformu aşırı hızlı veya yoğun otomasyonları tespit ettiğinde hesaplara geçici işlem kısıtlaması (action block) getirebilir. Gecikme sürelerini agresif şekilde düşürmemeniz tavsiye edilir.
* Facebook ile çapraz paylaşılan Reels videolarındaki bazı yorumlar Instagram tarafındaki teknik altyapı nedeniyle sunucuda hemen temizlenmeyebilir.
* Projenin Instagram veya Meta ile resmi bir bağı yoktur; kullanım kaynaklı tüm sorumluluk kullanıcıya aittir.

---

## 🤝 Katkıda Bulunma

Instagram web arayüzü ve DOM etiketleri sık sık güncellenmektedir. Seçicilerin güncellenmesi veya hata bildirimleri için **Pull Request** açabilir ya da **Issues** sekmesinden hata kaydı oluşturabilirsiniz.

---

## 📄 Lisans

Bu proje [MIT Lisansı](./LICENSE) kapsamında sunulmaktadır. Dilediğin gibi geliştirebilir, değiştirebilir ve dağıtabilirsin.
