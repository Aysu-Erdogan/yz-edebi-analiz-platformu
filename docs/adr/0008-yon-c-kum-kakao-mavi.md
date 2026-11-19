# ADR 0008: Yön C: Kum, Kakao, Mavi

**Durum:** Kabul · **Tarih:** 2026-11-19 · **ADR 0007'nin renk, yazı tipi ve biçim kararlarının yerine geçer**

## Bağlam

ADR 0007 "Akademik Lacivert" yönünü seçmişti. Sonradan proje sahibi kesin bir renk kuralı ve bir referans görsel verdi: sade, modern, geniş boşluklu bir sayfa tarzı. Kural: **%60 Blush Sand `#E2E0D8`, %30 Cocoa Brown `#35281E`, %10 Electric Blue `#2E6BFF`**. Tüm tasarımlar bu kodlara ve orana uyar.

## Karar

**Yön C** geçerli tasarım yönüdür. Yalnızca açık tema vardır.

**Renk dağılımı**

- **Kum %60:** sayfa zemini, üst çubuk, kartlar. Beyaz kullanılmaz; kartlar kenarlıkla ayrılır.
- **Kakao %30:** tüm metin ve başlıklar, koyu özet kartları, tablo başlığı, alt bilgi.
- **Elektrik mavi %10:** birincil düğme, rozet, seçili sayfa çizgisi, odak halkası. Mavi ikincil bir renk değil, vurgudur.
- Kakao ve kumun türevleri (kakao %80 soluk metin `#584D43`, kakao %8 hafif zemin `#D4D1C9`, saydam kakao kenarlık) yeni renk sayılmaz.
- Durum renkleri (başarı `#166534`, uyarı `#92400E`, hata `#B91C1C`) ve model renkleri veri rengidir, %10 vurgu payının dışındadır.

**Kontrast kuralları (WCAG)**

| Kullanım | Oran | Karar |
| --- | --- | --- |
| Kakao metin, kum zemin | 10.78 | Ana metin |
| Kum metin, kakao zemin | 10.78 | Koyu kartlar ve alt bilgi |
| Beyaz metin, mavi düğme | 4.50 | Düğme yazısı |
| Mavi metin, kum zemin | 3.41 | **Küçük metinde kullanılmaz**; yalnızca ikon, çizgi, büyük metin |
| Kum metin, mavi zemin | 3.41 | Küçük metinde kullanılmaz |

Bağlantılar kakao renkli ve altı çizilidir, mavi değildir.

**Yazı tipi:** Başlık ve gövde için **Inter** (başlıklar çok büyük ve kalın, ağırlık 800). Üretilen edebi metinler okumayı kolaylaştırmak için serif italik (Crimson Pro) gösterilir. Eski yönün Source Serif 4 ve Atkinson Hyperlegible tercihleri geçersizdir.

**Biçim (referans görsel):** Kum zeminde sade üst çubuk (harf aralıklı küçük büyük harfli logo, soluk menü, seçili sayfada mavi alt çizgi). Tam yuvarlak (hap) düğmeler ve rozetler. İkincil seçenekler düz yazı ve ok (›). Kartlarda yaklaşık 20 px köşe, geniş boşluk, ortalanmış büyük sayfa başlığı.

**Model renkleri (mavisiz, renk körlüğüne uygun):** Model 1 turuncu-kiremit `#B84F00`, Model 2 yeşil `#00785A`, Model 3 mor-pembe `#A8508A`. Renge ek olarak her modelde farklı işaret (daire, kare, üçgen) ve çubuklarda desen kullanılır. Mavi bilerek model rengi değildir, çünkü vurgu ile karışır.

**Araç:** Stitch ile ekran üretimi bırakıldı (yeni palette iki denemede zaman aşımı). Sayfalar F3'te, `docs/tasarim/onizleme.html` içindeki Yön C önizlemesinin tasarım diliyle doğrudan kodlanır. Stitch çıktısı hiçbir zaman koda alınmaz.

## Sonuçlar

- ADR 0007'nin **sayfa düzeltme listesi geçerli kalır** (düzen ve içerik hataları paletten bağımsız). Yalnızca renk, yazı tipi ve biçim kararları bu kayıtla değişir.
- Mavi küçük metinde kullanılamadığı için bağlantı ve etiket tasarımları kakao tabanlı olur.
- Koyu tema bu üç renkle tanımlanmadı. İstenirse ayrı bir kararla eklenir.
- Stitch'teki eski 5 ekran lacivert paletlidir ve geçersizdir (yalnızca düzen referansı olarak durur).
