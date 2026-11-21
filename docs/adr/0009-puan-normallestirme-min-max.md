# ADR 0009: Puan normalleştirme: aralık tabanlı (min-max)

**Durum:** Kabul · **Tarih:** 2026-11-21

## Bağlam

Rubrik ölçeği rubrik başına ayarlanabilir (ör. 1–5). Arayüz ve analiz için puanlar 0–100'e çevrilir (İş planı, Bölüm 6). Plan "0–100'e normalleşir" diyor ama formülü belirtmiyor. İki yol var:

| Yol | Formül | 1–5 ölçeğinde 1, 3, 5 |
| --- | --- | --- |
| **Aralık tabanlı (min-max)** | (puan − en küçük) / (en büyük − en küçük) × 100 | 0, 50, 100 |
| Oran tabanlı | puan / en büyük × 100 | 20, 60, 100 |

## Karar

**Aralık tabanlı (min-max)** kullanılır. Hesap tek yerde, `Backend/src/domain/scoring.ts` içindeki `normalizeScore` fonksiyonunda yapılır ve birim testlidir (T06).

- Ölçeğin en düşük puanı 0, en yüksek puanı 100 olur; ara değerler eşit aralıklıdır.
- Ölçeğin dışındaki puan **sessizce kırpılmaz**, hata fırlatır. Sahte puan üretmeyiz (ADR 0004).
- Geçersiz ölçek (en küçük ≥ en büyük) sıfıra bölmeye izin vermez, hata fırlatır.

## Gerekçe

Oran tabanlıda "en düşük puanı alan metin" 0 yerine 20 görünür; bu hem okuyucuyu yanıltır hem de farklı ölçekleri (1–4, 1–5, 0–10) karşılaştırmayı bozar. Aralık tabanlı yöntem ölçekten bağımsızdır ve standarttır.

## Sonuçlar

- Rubrik ölçeği değişirse (ör. gerçek rubrikte 1–4) normalleştirme kod değişmeden doğru çalışır.
- Ağırlıklı toplam puan (F2) önce ham ölçekte hesaplanır, sonra bu fonksiyonla 0–100'e çevrilir. Hesap tek yerde kalır.
- Savunmada "neden 3 puan 50 görünüyor?" sorusunun cevabı bu kayıttır.
