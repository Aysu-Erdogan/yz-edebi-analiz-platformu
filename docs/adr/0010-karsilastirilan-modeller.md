# ADR 0010: Karşılaştırılan modeller: orta sınıf (Claude Sonnet 5.5, Gemini 4 Hydrogen, GPT-6.2 Sol)

**Durum:** Kabul · **Tarih:** 2026-11-21 (GPT-6.2 Sol eklendi ve Gemini modeli 3.8 Flash'tan 4 Hydrogen'e yükseltildi: 2026-11-22)

## Bağlam

Platform üretken yapay zekâ modellerinin Türkçe edebi metin başarısını karşılaştırıyor. Karşılaştırmanın adil olması için modellerin **aynı sınıftan** (fiyat ve yetenek bakımından benzer) seçilmesi gerekiyor. Başvuru önerisinde üçüncü model olarak GPT de vardı. Başta OpenAI anahtarı ve adaptörü yoktu, 22 Kasım 2026'da ikisi de hazırlandı ve gerçek servisle doğrulandı.

## Karar

Ana karşılaştırma **orta sınıf** modellerle yapılır:

| Aile               | Model kimliği       | Girdi / çıktı ($ milyon token)                         |
| ------------------ | ------------------- | ------------------------------------------------------ |
| Claude (Anthropic) | `claude-sonnet-5-5` | 2 / 10                                                 |
| Gemini (Google)    | `gemini-4-hydrogen` | 1,50 / 7,50 (belgede tarihli bir zam yok, 22 Kas 2026) |
| GPT (OpenAI)       | `gpt-6.2-sol`       | 2 / 10                                                 |

- Model listesi **veridir**, koda gömülmez: `Backend/prisma/seed-data/models.json` dosyasından `provider_models` tablosuna yüklenir (`npm run db:seed`). Model emekli olunca kayıt güncellenir, kod değişmez.
- Seed, var olan kayda dokunmaz (yönetici ayarladığı `active` ve parametreleri ezmez). Bu yüzden dev veritabanında eski bir model kaydı varsa seed onu kapatmaz.
- Varsayılan üretim parametresi `maxTokens: 8192`. Düşünen modellerde düşünme tokenleri de bu sınıra dahildir; yarım kalan cevap kaydedilmez, hata olur (ADR 0004). İlk gerçek üretimde ölçülüp ayarlanır.
- Süre sınırı model başına: Claude ve GPT için 120 sn, **Gemini 4 Hydrogen için 300 sn** (bir kelimelik JSON isteği 83,6 sn sürdü; rakam ilk gerçek üretimde ayarlanır).
- Ek olarak ucuz sınıf (`claude-haiku-5-5`, `gemini-3.5-flash-lite`, `gpt-6-luna`) ileride "model boyutu fark yaratıyor mu?" sorusu için eklenebilir; ilk ikisi `llm:smoke` ile doğrulandı.

## Sınıf eşitleme gerekçesi (yöntem bölümü için)

**İlke.** Üç aileden birer model, **aynı fiyat ve konumlandırma sınıfından** seçilir. Sağlayıcıların sınıf adları birbirine denk değildir (Sonnet, Sol, Flash, Hydrogen) ve Google "orta sınıf" diye bir tanım vermez. Eşleştirme bu yüzden **milyon token fiyatına** ve sağlayıcının kendi konumlandırma ifadesine göre araştırmacı tarafından yapılmıştır. Bu bir yöntem sınırlılığıdır ve raporda açıkça yazılmalıdır.

| Aile   | Model               | Fiyat ($ milyon token) | Sağlayıcının kendi konumlandırması                                                                                                                    |
| ------ | ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude | `claude-sonnet-5-5` | 2 / 10                 | Haiku 5.5 (0,10 / 0,50, en ucuz) ile Opus 5.5 (4 / 20, en güçlü) arasındaki orta model.                                                               |
| GPT    | `gpt-6.2-sol`       | 2 / 10                 | OpenAI "günlük işlerin ana modeli, zekâ ile maliyeti dengelemek için" diyor. Üstünde Astra (8 / 40, amiral gemisi), altında Terra (1 / 5) ve Luna.     |
| Gemini | `gemini-4-hydrogen` | 1,50 / 7,50            | Google "ileri düzey zekâyı herkese getirir" diyor ve sınıf adı vermiyor. Gemini 4 ailesi: Hydrogen, Neon, Argon, Carbon (Carbon "en güçlü model").    |

**İlk seçim ve neden değişti.** Gemini için ilk seçim `gemini-3.8-flash` idi (21 Kasım 2026): Flash sınıfı Gemini'nin orta modeliydi. 22 Kasım 2026'da araştırmacı kararıyla `gemini-4-hydrogen`'e geçildi, çünkü Gemini'nin diğer iki modelle **aynı sınıfta yarışabilmesi** için bir üst modele çıkarılması gerekiyordu:

1. Fiyatı ($0,75 / $3,75) Sonnet ve Sol'un ($2 / $10) yarısından azdı, yani bir basamak altta kalıyordu.
2. Google'ın modeller sayfası onu "önceki nesil Flash" olarak anıyor; Claude ve GPT için seçilen modeller ise kendi ailelerinin güncel nesli.
3. Yoğunluk sorunu (HTTP 503 "yüksek talep") iki gün boyunca sürdü.

**Gemini 4 içinden neden Hydrogen.** Google hangisinin "orta" olduğunu söylemediği için fiyat kullanıldı:

| Model               | Fiyat ($ milyon token)                    | Karar                                                                                                      |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `gemini-4-hydrogen` | 1,50 / 7,50                               | **Seçildi.** Fiyatı Sonnet ve Sol'a en yakın, belgede tarihli zam yok.                                     |
| `gemini-4-argon`    | 2 / 10, **1 Aralık 2026'dan sonra 4 / 20** | Bugün birebir aynı fiyat, ama üretim Aralık-Ocak'a denk gelecek ve fiyat iki katına çıkacak.                |
| `gemini-4-neon`     | 3 / 15                                    | Sonnet ve Sol'dan bir adım pahalı.                                                                         |
| `gemini-4-carbon`   | Argon ile aynı                            | Google "en güçlü" diyor: orta sınıf değil.                                                                 |

**Eşitlemenin sınırı.** Hydrogen'in fiyatı ($1,50 / $7,50) hâlâ Sonnet ve Sol'un altındadır: eşitleme **tam değil, "en yakın"**dır. Sınıf eşleştirmesi araştırmacıya aittir; sonuçlar yorumlanırken bu belirtilmelidir.

## Sınırlılıklar (yöntem bölümünde yazılmalı)

1. **Sıcaklık sabitlenemiyor.** Yeni Claude modelleri sıcaklık değerini reddediyor, yeni Gemini modelleri yok sayıyor. Modeller kendi varsayılan ayarlarıyla çalışır. Bu yüzden çıktılar her çağrıda farklıdır ve aynı komut birden çok kez tekrarlanır (replicate).
2. **Modeller "düşünür."** Cevap öncesi iç düşünme yaparlar ve miktarı modele göre farklıdır; bu bir karıştırıcı etkendir. Düşünme tokenleri ücretlendirilir. Örnek: Gemini 4 Hydrogen bir kelimelik JSON isteğinde 219 çıkış token harcadı, GPT-6.2 Sol aynı istekte 15.
3. **Fiyat ve model adları değişkendir.** Gemini 3.8 / 3.6 Flash fiyatı 1 Ocak 2027'de iki katına çıkar, Gemini 4 Argon ve Carbon fiyatı 1 Aralık 2026'da iki katına çıkar; Hydrogen için tarih belgede yok. Model adları belgelerden alınmış, `llm:smoke` ile gerçek istekle teyit edilmiştir.
4. **Gemini 4 Hydrogen'in kararlılığı sınırlı gözlemlendi.** Yalnızca iki istek denendi (bkz. gözlemler); güvenilirlik hakkında kesin bir şey söylenemez.

## Gerçek servis gözlemleri (`llm:smoke`, 21-22 Kasım 2026)

Her istek bir kelimelik küçük bir istektir (bir metin, bir JSON); gerçek şiir/hikâye üretimini temsil etmez.

| Model                   | Gün          | Sonuç                                                                                                                                                                                                         |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-sonnet-5-5`     | 21, 22 Kas   | Çalışıyor: metin 1,5-1,6 sn, JSON 1,4-2,1 sn.                                                                                                                                                                 |
| `claude-haiku-5-5`      | 21, 22 Kas   | Çalışıyor: 1,1-2,2 sn. Bir kelimelik metin için 144-270 çıkış token (düşünme).                                                                                                                                |
| `gpt-6.2-sol`           | 22 Kas       | İlk denemede hesapta kredi yoktu (HTTP 429, anahtar geçerli). Sonra çalıştı: metin 2,7-3,6 sn, JSON 1,5-3,6 sn, 6 ve 15 çıkış token. Model adı, istek biçimi (Responses API), `store: false` ve katı JSON şeması kabul edildi. |
| `gemini-3.5-flash-lite` | 21, 22 Kas   | Çalışıyor: metin 0,7-1,4 sn, JSON 0,9-6,6 sn.                                                                                                                                                                 |
| `gemini-3.6-flash`      | 21 Kas       | Çalışıyor ama yavaş: metin 6 sn, JSON 28 sn.                                                                                                                                                                  |
| `gemini-3.8-flash`      | 21, 22 Kas   | **Yoğun:** 21'inde HTTP 503 "yüksek talep" (30 sn'den geç), 22'sinde metin yine 503, JSON 120 sn'de zaman aşımı. Model adı ve anahtar doğru.                                                                  |
| `gemini-4-hydrogen`     | 22 Kas       | **Kısmen:** metin isteği HTTP 503 "yüksek talep" (3.8 ile aynı ileti), JSON isteği **83,6 sn** sürdü ve başarılı oldu (202 giriş + 219 çıkış token, ≈ $0,00195).                                                |

**OpenAI bakiye hatası.** OpenAI kredi bitince HTTP 429 verir (tür `insufficient_quota`, kod `credit_balance_exhausted`). Adaptör bunu geçici hız sınırı değil kalıcı bakiye hatası (`auth`) sayar ve yeniden denemez; bu sınıflandırma gerçek cevapla doğrulandı.

Çıkarımlar:

- **Süre sınırları geniş tutulur.** Düşünen Gemini modelleri küçük işte bile 30-80 saniyeyi bulabiliyor; gerçek bir şiir üretiminde daha uzun sürer. Süre sınırı model başına ayarlanır.
- **503 yoğunluk hatası geçici sayılır** ve yeniden denenir (T08). Yoğunluk sürerse kayıt `failed` olur, sahte cevap yazılmaz (ADR 0004).
- **Yeni nesil Gemini modellerinin ikisi de (3.8 Flash, 4 Hydrogen) yoğunluk hatası verdi.** Eski nesil 3.6 Flash çalışıyor ama yavaş.

## Üretimden önce yapılacak

Karşılaştırma verisi üretilmeden önce Gemini modeli yeniden doğrulanır: bu ADR'deki gözlem tablosu güncellenir. Yoğunluk ya da yavaşlık üretimi engelliyorsa karar gerekçesiyle birlikte yeniden verilir. Yedek `gemini-3.6-flash`'tır, ama bu **eski nesil** olduğu için sınıf eşitliğini bozar; kullanılırsa sonuç raporunda gerekçesiyle yazılmalıdır. Hiçbir zaman sessiz yedeğe düşülmez (ADR 0004). Modelin sınıfı ve sürümü sonuçlarla birlikte kaydedilir.

## Sonuçlar

- Karşılaştırma üç aile ve orta sınıfla başlar. "100 metin için kabaca bir dolar altı" tahmini iki model için yapılmıştı; üç model için ilk gerçek üretimde yeniden ölçülür.
- ~~Çapraz yargıç ilkesi (modelin kendi metnini kendisinin puanlamaması, İş planı 7.3) için üç aileden birer yargıç modeli kullanılabilir.~~ **Bu madde 23 Kas 2026'da geçerliliğini yitirdi:** üç model yalnızca yazardır, puanı tek sabit hakem (DeepSeek Flash) verir (ADR 0011). Modellerin seçimi ve sınıf eşitlemesi geçerliliğini korur.
