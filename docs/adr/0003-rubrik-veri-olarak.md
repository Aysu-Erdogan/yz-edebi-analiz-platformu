# ADR 0003: Rubrik kod değil veridir

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

Uzman görüşüyle geliştirilecek gerçek rubrik, etik kurul onayı beklediği için henüz yok. Platformun rubrik olmadan da kurulması, rubrik gelince yalnızca rubriğin değiştirilmesi isteniyor.

## Karar

- Rubrik; tür, sürüm, ölçek, kriterler, ağırlıklar ve düzey açıklamalarıyla **veritabanında ve JSON olarak** tutulur.
- Bir rubrik bir değerlendirmede kullanıldıktan sonra **değiştirilemez**; değişiklik yeni sürüm olur (`Rubric.usedAt`).
- Her değerlendirme hangi rubrik sürümüyle yapıldığını kaydeder. Yeni rubrik gelince eski metinler yeniden puanlanabilir.
- Gerçek rubrik gelene kadar **"v0.1-taslak"** kullanılır. Taslakla üretilen her sonuç arayüzde ve dışa aktarımda "uzman doğrulaması yok" uyarısı taşır.
- Puan ölçeği rubrik başına ayarlanır (ör. 1–5 düzey) ve 0–100'e normalleştirilir.

## Sonuçlar

- Rubrik değişimi kod değişikliği gerektirmez.
- Rubrik doğrulaması (ağırlık toplamı, eksik alan) tek yerde, zod şemasıyla yapılır.
- Daha fazla tablo ve sürüm yönetimi mantığı gerekir (kabul edilen maliyet).
