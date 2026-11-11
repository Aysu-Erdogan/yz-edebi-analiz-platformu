# ADR 0007: Arayüz tasarım yönü: Akademik Lacivert

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

Arayüz eski prototipten alınmayacak, sıfırdan tasarlanacak (İş planı, F0). Platformun asıl işi modelleri puanlarla karşılaştırmak: tablo, radar grafiği, ısı tablosu, istatistik tablosu. İki yön denendi (`docs/tasarim/onizleme.html`):

- **A, Akademik Lacivert:** lacivert ana renk, kehribar vurgu, serif başlık, okunaklı sans gövde.
- **B, Edebi Sıcak:** kahverengi-bej ana renk, serif başlık ve serif gövde.

## Karar

**Yön A** seçildi.

- Renkler: zemin `#F8FAFC`, kart `#FFFFFF`, metin `#0F172A`, ana `#1E3A5F`, vurgu `#B45309`. Başarı `#166534`, uyarı `#92400E`, hata `#B91C1C`.
- Yazı: başlıkta serif (önizlemede Crimson Pro, Stitch tasarımında Source Serif 4), gövdede Atkinson Hyperlegible.
- Üç model rengi (Okabe-Ito): `#0072B2`, `#B45F00`, `#B0508A`. Renge ek olarak her modelde farklı işaret (daire, kare, üçgen) ve desen kullanılır; renk tek başına anlam taşımaz.
- Köşe yuvarlaklığı 8 px, yüksek kontrast, belirgin odak halkası.
- Ekran taslakları Stitch'te hazırlandı (proje "YZ Edebi Analiz Platformu", 5 ekran: Karşılaştır, Üretim ve Kütüphane, Sonuçlar ve Analiz, Rubrik, Hakkında). Stitch çıktısı yalnızca **görsel referanstır**, koda olduğu gibi alınmaz; F3'te bileşenler sıfırdan, tasarım sistemine göre yazılır.

## Gerekçe

Sayı yoğun ekranlarda okunurluk edebi hava kadar önemli. B'nin serif gövdesi küçük boyutlu tablolarda yorucu. Başlıklardaki serif zaten edebiyat temasını taşıyor.

## Sonuçlar ve F3'te uygulanacak düzeltmeler

Stitch'in ürettiği ekranlar örnek veri içerir; aşağıdakiler kodlanırken düzeltilir.

**Tüm ekranlar**

- Örnek tarih, proje kodu ("TR-LIT-2024" gibi), model sürümü ve uydurma sürüm geçmişi gerçek veriyle (API) değişir. Model adları yapılandırmadan gelir.
- Gezintide "Rubrik ve Hakkında" tek öğe ama iki sayfa: sekme veya alt gezinti tasarlanacak.
- Üstteki "Yeni Analiz" düğmesinin işlevi netleştirilecek, yoksa kaldırılacak.
- Avatar yok. Yönetici girişi F4'te gelir.
- Hata kartlarında veritabanı adı anılmaz (veritabanı MySQL).
- Kriterlerde model renkleri kullanılmaz (model renkleri yalnızca modelleri gösterir).

**Üretim ve Kütüphane**

- Filtre kutularında metin taşması giderilir.
- Seçilen metin tablonun altında kart yerine yan çekmece olarak açılır.

**Sonuçlar ve Analiz**

- Isı tablosu tek bir renk skalası kullanır (şimdi yüksek puan lacivert, düşük puan model renginde boyalı, iki anlam karışıyor).
- Kruskal-Wallis model çifti başına değil, **tek genel test** olarak gösterilir. İkili karşılaştırmalar çoklu karşılaştırma düzeltmeli (Holm veya Bonferroni) Mann-Whitney ile yapılır.
- Yargıç kararlılığı için Cohen Kappa yerine sürekli puanlara uygun ölçü (ICC veya Krippendorff alfa) kullanılır.
- Çubuk grafikte desenler gerçekten çizilir.

**Rubrik**

- Ağırlık doğrulama uyarısı tabloyu kesmeyecek biçimde yerleştirilir; yeşil ve kırmızı durum aynı anda görünmez.
- Puan düzeyi sınırları boşluksuz tanımlanır (ör. 0–59, 60–79, 80–100) ve tek yerden okunur.
- "LLM-as-a-Judge" yerine "yargıç model" denir.

**Hakkında**

- Kriter listesi rubrik verisinden gelir (ekranlar arası çelişki giderilir).
- Lisans, "JSON Schema v1.0", depo yolu ve PDF düğmesi gibi henüz karar verilmemiş ya da olmayan öğeler kaldırılır.
- Kullanıcıya renk kodu (`#0072B2` vb.) gösterilmez.
