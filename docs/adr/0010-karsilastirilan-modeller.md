# ADR 0010: Karşılaştırılan modeller: orta sınıf (Claude Sonnet 5.5, Gemini 3.8 Flash, GPT-6.2 Sol)

**Durum:** Kabul · **Tarih:** 2026-11-21 (GPT-6.2 Sol 2026-11-22'de eklendi)

## Bağlam

Platform üretken yapay zekâ modellerinin Türkçe edebi metin başarısını karşılaştırıyor. Karşılaştırmanın adil olması için modellerin **aynı sınıftan** (fiyat ve yetenek bakımından benzer) seçilmesi gerekiyor. Başvuru önerisinde üçüncü model olarak GPT de vardı. Başta OpenAI anahtarı ve adaptörü yoktu, 22 Kasım 2026'da ikisi de hazırlandı ve gerçek servisle doğrulandı.

## Karar

Ana karşılaştırma **orta sınıf** modellerle yapılır:

| Aile | Model kimliği | Girdi / çıktı ($ milyon token) |
| --- | --- | --- |
| Claude (Anthropic) | `claude-sonnet-5-5` | 2 / 10 |
| Gemini (Google) | `gemini-3.8-flash` | 0,75 / 3,75 (31 Aralık 2026'ya kadar), sonra 1,50 / 7,50 |
| GPT (OpenAI) | `gpt-6.2-sol` | 2 / 10 |

- Model listesi **veridir**, koda gömülmez: `Backend/prisma/seed-data/models.json` dosyasından `provider_models` tablosuna yüklenir (`npm run db:seed`). Model emekli olunca kayıt güncellenir, kod değişmez.
- Seed, var olan kayda dokunmaz (yönetici ayarladığı `active` ve parametreleri ezmez).
- Varsayılan üretim parametresi `maxTokens: 8192`. Düşünen modellerde düşünme tokenleri de bu sınıra dahildir; yarım kalan cevap kaydedilmez, hata olur (ADR 0004). İlk gerçek üretimde ölçülüp ayarlanır.
- Ek olarak ucuz sınıf (`claude-haiku-5-5`, `gemini-3.5-flash-lite`) ileride "model boyutu fark yaratıyor mu?" sorusu için eklenebilir; ikisi de `llm:smoke` ile doğrulandı.
- GPT (OpenAI) listeye eklendi: `gpt-6.2-sol`, Claude Sonnet 5.5 ile aynı fiyat sınıfında. Daha ucuz seçenekler (`gpt-6.1-terra` 1 / 5, `gpt-6-luna` 0,10 / 0,50) ucuz sınıf karşılaştırması için ileride eklenebilir.

## Sınırlılıklar (yöntem bölümünde yazılmalı)

1. **Sıcaklık sabitlenemiyor.** Yeni Claude modelleri sıcaklık değerini reddediyor, yeni Gemini modelleri yok sayıyor. İki model de kendi varsayılan ayarlarıyla çalışır. Bu yüzden çıktılar her çağrıda farklıdır ve aynı komut birden çok kez tekrarlanır (replicate).
2. **Modeller "düşünür."** Cevap öncesi iç düşünme yaparlar ve miktarı modele göre farklıdır; bu bir karıştırıcı etkendir. Düşünme tokenleri ücretlendirilir.
3. **Fiyat ve model adları değişkendir.** Gemini 3.8 Flash fiyatı 1 Ocak 2027'de iki katına çıkar. Model adları belgelerden alınmıştır; kullanmadan önce `npm run llm:smoke -- --claude claude-sonnet-5-5 --gemini gemini-3.8-flash` ile teyit edilir.

## Gerçek servis doğrulaması (21 Kasım 2026, `llm:smoke`)

| Model | Sonuç |
| --- | --- |
| `claude-sonnet-5-5` | Çalışıyor: metin 1,5 sn, JSON 1,4 sn. |
| `gemini-3.8-flash` | Model adı ve anahtar doğru, ama **HTTP 503 "yüksek talep"** döndü. Servis hatayı 30 saniyeden geç veriyor. Geçici bir yoğunluk. |
| `gemini-3.6-flash` | Çalışıyor, ama yavaş: metin 6 sn, JSON 28 sn (bir kelimelik istek, düşünme tokenleri dahil). |
| `gemini-3.5-flash-lite` (önceki deneme) | Çalışıyor, hızlı: 1-2 sn. |

Çıkarımlar:

- **Süre sınırları geniş tutulur.** Düşünen Gemini modelleri küçük işte bile 30 saniyeyi bulabiliyor; gerçek bir şiir üretiminde daha uzun sürer. Üretimde varsayılan deneme süre sınırı model başına ayarlanabilir olmalı (varsayılan 120 sn).
- **503 yoğunluk hatası geçici sayılır** ve yeniden denenir (T08). Yoğunluk sürerse kayıt `failed` olur, sahte cevap yazılmaz (ADR 0004).
- **Gemini için yedek model:** `gemini-3.6-flash` doğrulanmış yedektir; ana model (`gemini-3.8-flash`) yoğunluk nedeniyle kullanılamazsa karar yeniden verilir. Karşılaştırma verisi üretilmeden önce son karar kayda geçirilir (modelin sınıfı ve sürümü sonuçlarla birlikte yazılmalı).

## Gerçek servis doğrulaması (22 Kasım 2026, `llm:smoke`)

| Model | Sonuç |
| --- | --- |
| `claude-sonnet-5-5` | Çalışıyor: metin 1,6 sn, JSON 2,1 sn. |
| `gemini-3.8-flash` | **Yoğunluk sürüyor:** metin isteği yine HTTP 503 "yüksek talep", JSON isteği 120 sn'de zaman aşımı. |
| `gpt-6.2-sol` (OpenAI, aday) | **Çalışıyor** (kredi yüklendikten sonra): metin 2,7 sn, JSON 1,5 sn. Model adı, istek biçimi (Responses API), `store: false` ve katı JSON şeması kabul edildi. İlk denemede hesapta kredi yoktu: OpenAI bakiye hatasını 429 ile bildirir (tür `insufficient_quota`, kod `credit_balance_exhausted`); adaptör bunu geçici hız sınırı değil kalıcı bakiye hatası (`auth`) sayar, yeniden denemez. Bu sınıflandırma gerçek cevapla doğrulandı. |

OpenAI orta sınıf adayı `gpt-6.2-sol` ($2 giriş / $10 çıkış, milyon token), daha ucuz seçenekler `gpt-6.1-terra` ($1/$5) ve `gpt-6-luna` ($0,10/$0,50). `gpt-6.2-sol` doğrulandı ve `models.json`'a eklendi.

## Sonuçlar

- Karşılaştırma üç aile ve orta sınıfla başlar. "100 metin için kabaca bir dolar altı" tahmini iki model için yapılmıştı; üç model için ilk gerçek üretimde yeniden ölçülür.
- Çapraz yargıç ilkesi (modelin kendi metnini kendisinin puanlamaması, İş planı 7.3) için üç aileden birer yargıç modeli kullanılabilir.
