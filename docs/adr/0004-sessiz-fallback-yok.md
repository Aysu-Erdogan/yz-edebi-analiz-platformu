# ADR 0004: Sessiz fallback yok

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

İlk prototip, yargıç modelin çıktısı bozuk geldiğinde her kritere 70 puan, API hata verdiğinde 50 puan veriyordu; sıfır puanı da "eksik" sayıp 50'ye çeviriyordu. Kullanıcı bu uydurma sayıları gerçek değerlendirme sanabilir. Bilimsel bir çalışmada bu, sonuçları sessizce bozar.

## Karar

- Üretim, değerlendirme ve iş kayıtları açık bir **durum** taşır: `pending | running | succeeded | failed` ve hata nedeni.
- Yargıç çıktısı zod ile doğrulanır. Geçersizse bir kez yeniden denenir, yine geçersizse kayıt **`failed`** olur. Uydurma puan yazılmaz.
- 0 geçerli bir puandır. "Eksik" ancak `null/undefined` demektir.
- Arayüz başarısız kayıtları açıkça gösterir ve yeniden deneme sunar.
- İstemciye iç hata ayrıntısı gitmez (yalnızca `requestId`), ayrıntı günlüğe yazılır.

## Sonuçlar

- Veri setinde yalnızca gerçekten alınmış puanlar bulunur; analiz güvenilir olur.
- Arayüzde ve iş kuyruğunda "başarısız" durumunu yönetmek gerekir (planlanmış iştir).
