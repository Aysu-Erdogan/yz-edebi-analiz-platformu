# Proje Bitirme Raporu (canlı belge)

**Amaç:** Bu belge, bitirme raporunun, TÜBİTAK sonuç raporunun ve ileride yazılacak makalenin **ham malzemesidir**. Projede elde edilen her veri, karar, gerekçe ve sayı burada, kaynağıyla birlikte tutulur. Rapor yazılırken bu belgeden kopyalanır; hiçbir şey hafızadan yazılmaz.

**Nasıl tutulur:**

- Her bilgi **tarih** ve **kaynak** (komut, commit, ADR, belge adresi) taşır.
- Etiketler: **[Veri]** ölçülmüş ya da okunmuş sayı, **[Karar]** verilmiş karar ve gerekçesi, **[Yorum]** çıkarım (kanıtı zayıf olabilir), **[Hesap]** bizim hesapladığımız değer, **[TODO]** eksik, sonradan doldurulacak.
- Yeni bir veri ya da bilgi çıktığında Claude "şimdi bu belgeye ekleyeyim mi?" diye sorar; onayla eklenir. Değişiklikler en altta "Değişiklik günlüğü"ne yazılır.
- Karar gerekçelerinin ayrıntısı `docs/adr/` altındadır; bu belge onların rapora uygun özetini ve ham verileri tutar.

---

## 1. Proje özeti

**[Veri]** YZ Edebi Analiz Platformu: Claude, Gemini ve GPT ailelerinden birer modele **aynı komutla** Türkçe edebi metin (şiir, hikâye, deneme) ürettirip, bir **rubrikle** puanlayıp karşılaştıran bir web platformudur. Proje hem TÜBİTAK 2209-A hem bitirme projesi olarak yürütülür.

**[Veri]** Teknoloji: TypeScript 6.0, Node 22, Express 5, Prisma 7 (MySQL 8), zod 4, vitest 5; arayüz React + Vite + Tailwind (henüz kodlanmadı). Mimari: `routes → services → repositories`. Kaynak: `Backend/package.json`, ADR 0001-0006.

## 2. Takvim ve ilerleme

| Tarih                 | Olay                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| 19 Kas 2026           | F0 (hazırlık ve iskelet) tamamlandı, `main`'e birleşti (PR #1)                             |
| 21 Kas 2026           | F1 (backend çekirdeği) birleşti (PR #10, `464cd3f`)                                        |
| 22 Kas 2026           | OpenAI adaptörü, GPT-6.2 Sol, Gemini 4 Hydrogen, ADR 0010 birleşti (PR #12, `4c273e1`)      |
| 10 Ocak 2027          | Yazılım dondurma                                                                           |
| 31 Ocak 2027          | TÜBİTAK bitiş                                                                              |
| Şubat / Mayıs 2027    | Bitirme raporu / sunum                                                                     |

**[Veri]** F1 planı 23 Kas-6 Ara 2026 arasındaydı; plan başlamadan, 21 Kas'ta birleşti (kaynak: `docs/IS_PLANI.md`). Fazlar F0-F7; sırada F2 (yargıç motoru, iş kuyruğu, istatistik, dışa aktarma).

**[Veri]** Yazılım doğrulama ilerlemesi (otomatik test sayısı): 56 (ilk adım) → 91 → 107 → 129 → 142 → 191 → 204 → 225 → 256 → **275** (22 Kas 2026). Kod kapsamı yaklaşık %96. Her PR'da dört otomatik kontrol (biçim, backend, frontend, Docker Compose) çalışır; PR #10 ve #12 hepsini geçti. Kaynak: oturum kayıtları, GitHub Actions.

## 3. Yöntem

### 3.1 Karşılaştırılan modeller ve seçim gerekçesi

**[Karar]** Üç aileden birer **orta sınıf** model, aynı fiyat ve konumlandırma sınıfında karşılaştırılır (kaynak: ADR 0010):

| Aile   | Model               | Fiyat ($/milyon token, girdi / çıktı) | Sağlayıcının konumlandırması                                                  |
| ------ | ------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Claude | `claude-sonnet-5-5` | 2 / 10                                | Haiku 5.5 (en ucuz) ile Opus 5.5 (en güçlü) arasındaki orta model             |
| GPT    | `gpt-6.2-sol`       | 2 / 10                                | OpenAI: günlük işlerin ana modeli, zekâ ile maliyeti dengeler                 |
| Gemini | `gemini-4-hydrogen` | 1,50 / 7,50                           | Google: "ileri düzey zekâyı herkese getirir" (sınıf adı yok)                  |

**[Karar]** Sınıf eşleştirmesi **sağlayıcı sınıf adlarına değil, milyon token fiyatına** ve sağlayıcının kendi konumlandırma ifadesine dayanır, çünkü sınıf adları (Sonnet, Sol, Flash, Hydrogen) birbirine denk değildir ve Google "orta sınıf" tanımı vermez. **Bu bir yöntem sınırlılığıdır.**

**[Karar, 22 Kas 2026] Gemini neden 3.8 Flash'tan 4 Hydrogen'e yükseltildi?** İlk seçim `gemini-3.8-flash` idi. Gemini'nin diğer iki modelle aynı sınıfta yarışabilmesi için üst modele çıkarıldı:

1. **Fiyat:** 3.8 Flash $0,75 / $3,75, yani Sonnet ve Sol'un ($2 / $10) yarısından azdı: bir basamak altta kalıyordu.
2. **Nesil:** Google'ın modeller sayfası 3.8 Flash'ı "önceki nesil Flash" olarak anıyor (22 Kas 2026); Claude ve GPT için seçilen modeller kendi ailelerinin güncel nesli.
3. **Kararlılık:** 3.8 Flash iki gün boyunca HTTP 503 "yüksek talep" ve zaman aşımı verdi (bkz. 4.2, R2-R5).

**[Karar]** Gemini 4 içinden Hydrogen seçildi, çünkü Google hangisinin "orta" olduğunu söylemiyor ve fiyat en yakın olanı gösteriyor:

| Gemini 4 modeli     | Fiyat ($/milyon token)                                  | Karar                                                              |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `gemini-4-hydrogen` | 1,50 / 7,50                                             | **Seçildi**: Sonnet ve Sol'a en yakın, belgede tarihli zam yok     |
| `gemini-4-argon`    | 2 / 10, **1 Aralık 2026'dan sonra 4 / 20**              | Elendi: üretim Aralık-Ocak'a denk gelecek, fiyat iki katına çıkar  |
| `gemini-4-neon`     | 3 / 15                                                  | Elendi: bir adım pahalı                                            |
| `gemini-4-carbon`   | Argon ile aynı                                          | Elendi: Google "en güçlü model" diyor, orta sınıf değil            |

**[Yorum]** Eşitleme **tam değil, "en yakın"**dır: Hydrogen'in fiyatı ($1,50 / $7,50) hâlâ Sonnet ve Sol'un altındadır. Sonuçlar yorumlanırken bu belirtilmelidir.

**[Karar]** GPT için `gpt-6.2-sol` seçildi: OpenAI'nin kendi konumlandırmasıyla orta sınıf ("go-to model for everyday work"), Sonnet ile birebir aynı fiyat, ayrıca gerçek servisle doğrulandı. Alternatif `gpt-6.1-terra` ($1 / $5) bir sürüm eski ve "hızlı ve verimli" olarak tanımlı olduğu için elendi. Üstü Astra ($8 / $40, amiral gemisi), altı Luna ($0,10 / $0,50).

**[Karar]** Ek karşılaştırma için ileride **ucuz sınıf** eklenebilir: `claude-haiku-5-5`, `gemini-3.5-flash-lite`, `gpt-6-luna` ("model boyutu fark yaratıyor mu?" sorusu). İlk ikisi gerçek servisle denendi.

**[TODO]** Gemini 4 Hydrogen kararı üretimden önce yeniden doğrulanacak (bkz. 4.4). Yedek `gemini-3.6-flash` eski nesildir, sınıf eşitliğini bozar; kullanılırsa gerekçesi raporda yazılmalıdır.

### 3.2 Metin üretim komutu ve parametreler

**[Veri]** Komut şablonu (`Backend/prisma/seed-data/prompts/generate-v1.json`, sürüm v1, **taslak**): _"Aşağıdaki tür ve tema için özgün bir Türkçe metin yaz. Tür: {{tur}} Tema: {{tema}} Uzunluk: {{uzunluk}} Yalnızca metnin kendisini yaz. Başlık, açıklama, yorum ya da giriş cümlesi ekleme."_

**[Veri]** Tür başına uzunluk yönergesi (taslak, danışmanla kesinleşecek; `Backend/src/domain/prompt.ts`): şiir 3-5 kıta, hikâye yaklaşık 250-350 sözcük, deneme yaklaşık 250-350 sözcük. Tema serbest, tek satır, en çok 32 karakter.

**[Karar]** Aynı doldurulmuş komut **tüm modellere** gider (T11); bir model başarısız olursa diğerleri sürer (T09); başarısız çağrı için **sahte metin üretilmez**, kayıt `failed` olur (ADR 0004).

**[Veri]** Model parametreleri (`Backend/prisma/seed-data/models.json`): `maxTokens` 8192; süre sınırı Claude ve GPT için 120 sn, Gemini 4 Hydrogen için 300 sn. Bir kelimelik JSON isteği 83,6 sn sürdüğü için Hydrogen'e geniş süre verildi (ilk gerçek üretimde ayarlanacak).

**[Karar]** Sıcaklık (temperature) gönderilmez: yeni Claude modelleri sıcaklığı reddeder, yeni Gemini modelleri yok sayar. Modeller kendi varsayılan ayarlarıyla çalışır, bu yüzden çıktı her çağrıda farklıdır ve aynı komut **birden çok kez tekrarlanır (replicate, 1-10)**.

**[Karar]** OpenAI isteğinde `store: false`: üretilen metinler OpenAI tarafında saklanmaz (etik güvence).

### 3.3 Hata, yeniden deneme ve maliyet güvenceleri

**[Karar]** (Kaynak: ADR 0004, ADR 0010, `Backend/src/providers/`)

- Geçici hatalar (kota/hız sınırı, zaman aşımı, 5xx) **en çok 3 kez**, 1-2-4 sn üstel geri çekilmeyle denenir; `Retry-After` dikkate alınır. Kalıcı hatalar (anahtar, geçersiz istek) ve bozuk cevaplar denenmez.
- Sessiz yedek yok: bir model/sağlayıcı kullanılamıyorsa başka modele geçilmez, açık hata verilir.
- Token sınırında kesilen, reddedilen, filtreye takılan ya da boş cevap hata sayılır, kaydedilmez.
- **Maliyet güvencesi:** işe başlamadan **en kötü durum** (çıktı = maxTokens) tahmini yapılır; kullanıcının koyduğu sınırı aşıyorsa hiçbir çağrı yapılmaz (T12); `dryRun` yalnızca tahmin verir.
- OpenAI bakiye bitince HTTP 429 verir (tür `insufficient_quota`, kod `credit_balance_exhausted`); bu **geçici hız sınırı değil kalıcı bakiye hatasıdır**, yeniden denenmez. Gerçek cevapla doğrulandı (R6).

### 3.4 Rubrik ve puanlama

**[Veri]** Şimdilik **taslak rubrik v0.1** kullanılıyor (`Backend/prisma/seed-data/rubrics/v0.1-taslak/`): her tür için 5 kriter, eşit ağırlık (0,2), 1-5 ölçeği, düzey açıklamaları 1, 3 ve 5 puan için.

| Tür    | Kriterler                                                                               |
| ------ | --------------------------------------------------------------------------------------- |
| Şiir   | İmge Gücü, Ritim ve Ahenk, Duygu Aktarımı, Özgünlük, Anlam Bütünlüğü                    |
| Hikâye | Olay Örgüsü, Karakter Tutarlılığı, Anlatım Gücü, Yaratıcılık, Tema İşlenişi             |
| Deneme | Düşünsel Derinlik, Tutarlılık, Dilsel Doğruluk, Kişisel Üslup, Özgünlük                 |

**[Veri]** Gerçek rubrik **etik kurul/uzman süreci bekliyor**; elimizdeki taslağı **yapay zekâ (Claude) yazdı, uzman doğrulaması yok**. Gerçek rubrik geldiğinde yalnızca veri değişecek (rubrik veri olarak tutulur, ADR 0003). **Bu, raporda açıkça belirtilmelidir.**

**[Karar]** Puan normalleştirme **aralık tabanlı (min-max)**: 1-5 ölçeğinde 1 → 0, 3 → 50, 5 → 100 (ADR 0009). Ölçek dışı puan sessizce kırpılmaz, hata verir. Ağırlıklar toplamı 1 olmalıdır; kullanılmış rubrik değiştirilemez, yeni sürüm açılır.

### 3.5 Yazılım doğrulama yöntemi

**[Karar]** Her yeni kural için **önce başarısız test**, sonra kod, sonra **bilerek bozma (mutation) kontrolü** yapılır: kural kasıtlı olarak bozulur ve ilgili testin kırmızıya döndüğü görülür (testlerin gerçekten işe yaradığının kanıtı). Gerçek servis çağrıları testlerde **sahte HTTP** ile taklit edilir; gerçek servis yalnızca `llm:smoke` ile kullanıcı onayıyla denenir. Gerçek MySQL testleri ayrı bir `_test` veritabanında çalışır (koruma: ad `_test`/`_ci` ile bitmiyorsa reddeder).

**[Veri]** OpenAI adaptöründe bu yöntemle 16 bozma uygulandı, 16'sı da bir testi kırmızıya çevirdi (22 Kas 2026). Üretim servisinde 8 bozma (hata izolasyonu, tekrar çarpanı, maliyet sınırı, dry-run, kapalı model, erken sağlayıcı kontrolü, çıktı tokeni, beklenmeyen hata).

### 3.6 Sürekli entegrasyon (CI)

**[Veri]** Her çekme isteğinde (PR) ve `main`'e her birleşmeden sonra GitHub Actions üzerinde, temiz bir Ubuntu ortamında **dört otomatik kontrol** çalışır (kaynak: `.github/workflows/ci.yml`). Aynı dal için yeni bir push gelirse eski çalışma iptal edilir. Bu, "yerelde geçen kodun temiz bir ortamda da geçtiği"nin kanıtıdır.

| Kontrol                                       | Ne yapar                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biçim kontrolü                                | Tüm projede prettier biçim denetimi (Node 22)                                                                                                                   |
| Backend (tip, lint, test, derleme, migration) | **MySQL 8.0 servisi** ile: Prisma doğrulama ve üretimi, tip kontrolü, lint, **kapsamlı test** (gerçek MySQL testleri dahil; CI'da atlanması hata sayılır), derleme, migration'ların gerçek MySQL'de uygulanması |
| Frontend (tip, lint, test, derleme)           | Tip kontrolü, lint, test ve kapsam, derleme                                                                                                                     |
| Docker Compose (derleme ve açılış)            | Backend ve Frontend geçince başlar: uygulamayı Docker ile derleyip ayağa kaldırır; arayüz üzerinden API sağlık ucunu ve ana sayfayı uçtan uca denetler           |

**[Veri]** İki ardışık çalışmanın iş süreleri (22 Kas 2026, PR #12; saniye):

| Commit    | Biçim | Frontend | Backend | Docker Compose |
| --------- | ----- | -------- | ------- | -------------- |
| `22b7998` | 15    | 48       | 58      | 137            |
| `a1aae65` | 7     | 49       | 69      | 107            |

**[Hesap]** Backend ve Frontend paralel çalışır, Docker bunların ardından başlar: bir PR'ın tüm kontrolleri yaklaşık **3-3,5 dakikada** biter (en uzun Backend/Frontend + Docker). **[Veri]** `main`'e birleşme sonrası CI, F0 (`dd40277`), F1 (`464cd3f`) ve OpenAI/model birleşmesinde (`4c273e1`) üçünde de başarılı bitti; PR #10 ve #12 dört kontrolün dördünden geçti. **[Yorum]** Gerçek MySQL ile her PR'da 275 testin koşulması, veritabanı katmanındaki kuralların (sürümleme, değişmezlik, kayıt) yalnızca sahte depoyla değil gerçek veritabanıyla da doğrulandığını gösterir.

---

## 4. Bulgular: gerçek servis deneme verileri

### 4.1 Deneme düzeni ve tekrar etme

**[Veri]** Deneme komutu: `llm:smoke` (`Backend/scripts/llm-smoke.ts`). Her modele **iki küçük gerçek istek** atar; tek deneme (yeniden deneme kapalı), süre sınırı varsayılan 30 sn.

```
cd Backend
npm run llm:smoke -- --claude <model> --gemini <model> --openai <model> --timeout <saniye>
```

- **Metin isteği** komutu: `Tek bir Türkçe kelime yaz: selam`
- **JSON isteği** komutu: `Yalnızca şu biçimde JSON ile cevap ver: {"cevap": "selam"}`; cevap şemayla doğrulanır (`{ cevap: string }`).
- `maxTokens` 1024 (düşünme tokenleri de dahil). Anahtarlar `.env`'den okunur, çıktıya yazılmaz.
- Adaptörler: Claude → Anthropic Messages API (resmi SDK 1.12, `output_config.format`); Gemini → `generateContent` (v1beta, `x-goog-api-key`, `responseJsonSchema`); GPT → Responses API (`/v1/responses`, katı JSON şeması).

**[Yorum]** Bunlar **bir kelimelik küçük istekler**dir: bağlantı, kimlik doğrulama ve temel davranış denemesidir, edebî üretim kalitesini ya da gerçek süre/maliyeti **temsil etmez**. Her model için N = 2-6 gözlem vardır; istatistiksel çıkarım yapılamaz.

### 4.2 Çalıştırma kayıtları

Kod sürümü: R1-R2 `ddfda94` / `2fb47db` (`--timeout` seçeneği henüz yoktu, süre sınırı 30 sn); R3-R4 `fbbd29d`; R5-R7 `feature/f1-openai-adaptoru` dalı (commit öncesi çalışma kopyası); R8 `22b7998` + fiyat satırı (`a1aae65`). Süre: sn; token: giriş / çıkış; maliyet: ekranda yazan yaklaşık değer ($).

| Koşu | Tarih  | Model                   | Metin isteği                         | JSON isteği                           | Durum                                                    |
| ---- | ------ | ----------------------- | ------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| R1   | 21 Kas | `claude-haiku-5-5`      | 1,7 · 27 / 177 · 0,00009             | 1,8 · 231 / 13 · 0,00003              | Başarılı. Toplam koşu: $0,00015                          |
| R1   | 21 Kas | `gemini-3.5-flash-lite` | 1,1 · 9 / 2 · 0,00001                | 1,7 · 20 / 8 · 0,00003                | Başarılı                                                 |
| R2   | 21 Kas | `claude-sonnet-5-5`     | 1,6 · 27 / 5 · 0,00010               | 1,8 · 231 / 13 · 0,00059              | Başarılı                                                 |
| R2   | 21 Kas | `gemini-3.8-flash`      | zaman aşımı (30 sn)                  | zaman aşımı (30 sn)                   | Başarısız                                                |
| R3   | 21 Kas | `claude-sonnet-5-5`     | 1,5 · 27 / 5 · 0,00010               | 1,4 · 231 / 13 · 0,00059              | Başarılı                                                 |
| R3   | 21 Kas | `gemini-3.8-flash`      | HTTP 503 "yüksek talep"              | HTTP 503 "yüksek talep"               | Başarısız (süre sınırı uzatıldı, değeri kayda geçmedi)                           |
| R4   | 21 Kas | `claude-haiku-5-5`      | 1,6 · 27 / 181 · 0,00009             | 1,2 · 231 / 13 · 0,00003              | Başarılı                                                 |
| R4   | 21 Kas | `gemini-3.6-flash`      | 6,0 · 9 / 119 · ≈ 0,00045 [Hesap]    | 27,9 · 20 / 140 · ≈ 0,00054 [Hesap]   | Başarılı, yavaş (fiyat tablosunda yoktu, biz hesapladık) |
| R5   | 22 Kas | `claude-sonnet-5-5`     | 1,6 · 27 / 5 · 0,00010               | 2,1 · 231 / 13 · 0,00059              | Başarılı. Toplam koşu: $0,00070                          |
| R5   | 22 Kas | `gemini-3.8-flash`      | HTTP 503 "yüksek talep"              | zaman aşımı (120 sn)                  | Başarısız                                                |
| R5   | 22 Kas | `gpt-6.2-sol`           | HTTP 429 "no credits remaining"      | HTTP 429 "no credits remaining"       | Başarısız: hesapta kredi yoktu (anahtar geçerli)         |
| R6   | 22 Kas | `claude-haiku-5-5`      | 2,2 · 27 / 267 · 0,00014             | 1,3 · 231 / 13 · 0,00003              | Başarılı. Toplam koşu: $0,00020                          |
| R6   | 22 Kas | `gemini-3.5-flash-lite` | 1,4 · 9 / 2 · 0,00001                | 0,9 · 20 / 8 · 0,00003                | Başarılı                                                 |
| R6   | 22 Kas | `gpt-6.2-sol`           | `auth (kalıcı)` `[credit_balance_exhausted]` | `auth (kalıcı)`                | Başarısız: bakiye hatası artık kalıcı sayılıyor          |
| R7   | 22 Kas | `claude-haiku-5-5`      | 2,1 · 27 / 270 · 0,00014             | 1,1 · 231 / 13 · 0,00003              | Başarılı. Toplam koşu: $0,00056                          |
| R7   | 22 Kas | `gemini-3.5-flash-lite` | 0,7 · 9 / 2 · 0,00001                | 6,6 · 20 / 8 · 0,00003                | Başarılı                                                 |
| R7   | 22 Kas | `gpt-6.2-sol`           | 2,7 · 16 / 6 · 0,00009               | 1,5 · 59 / 15 · 0,00027               | **Başarılı** (kredi yüklendikten sonra)                  |
| R8   | 22 Kas | `claude-haiku-5-5`      | 1,6 · 27 / 144 · 0,00007             | 1,3 · 231 / 13 · 0,00003              | Başarılı. Toplam koşu: $0,00241                          |
| R8   | 22 Kas | `gemini-4-hydrogen`     | HTTP 503 "yüksek talep"              | **83,6** · 202 / 219 · 0,00195        | Kısmen: metin başarısız, JSON başarılı ama çok yavaş     |
| R8   | 22 Kas | `gpt-6.2-sol`           | 3,6 · 16 / 6 · 0,00009               | 3,6 · 59 / 15 · 0,00027               | Başarılı                                                 |

**[Hesap]** Tüm koşuların toplam harcaması yaklaşık **$0,0065** (bir sentin altı); başarısız çağrıların sağlayıcı tarafında ücretlendirilip ücretlendirilmediği bilinmiyor.

### 4.3 Model bazlı özet

| Model                   | Gözlem sayısı (başarılı / toplam istek) | Metin süresi (sn) | JSON süresi (sn) | Çıkış tokeni (metin / JSON) | Not                                              |
| ----------------------- | --------------------------------------- | ----------------- | ---------------- | --------------------------- | ------------------------------------------------ |
| `claude-sonnet-5-5`     | 6 / 6 (3 koşu)                          | 1,5-1,6           | 1,4-2,1          | 5 / 13                      | Çok kararlı, çıktı tokeni sabit                  |
| `claude-haiku-5-5`      | 10 / 10 (5 koşu)                        | 1,6-2,2           | 1,1-1,8          | 144-270 / 13                | Tek kelime için çok düşünüyor (144-270 token)    |
| `gpt-6.2-sol`           | 4 / 4 (2 koşu, kredi sonrası)           | 2,7-3,6           | 1,5-3,6          | 6 / 15                      | Kararlı; düşünme maliyeti çok küçük              |
| `gemini-3.5-flash-lite` | 6 / 6 (3 koşu)                          | 0,7-1,4           | 0,9-6,6          | 2 / 8                       | En hızlı ve ucuz; ucuz sınıf adayı               |
| `gemini-3.6-flash`      | 2 / 2 (1 koşu)                          | 6,0               | 27,9             | 119 / 140                   | Çalışıyor ama yavaş; eski nesil                  |
| `gemini-3.8-flash`      | 0 / 6 (3 koşu)                          | 503 ya da zaman aşımı | 503 ya da zaman aşımı | -                | Yoğun; bu nedenle elendi                         |
| `gemini-4-hydrogen`     | 1 / 2 (1 koşu)                          | 503               | 83,6             | - / 219                     | Kısmen; üretimden önce yeniden denenecek         |

### 4.4 Gözlemler

1. **[Veri] Düşünme (akıl yürütme) tokenleri modele göre çok farklı.** Aynı bir kelimelik metin isteğinde çıkış tokeni: Claude Sonnet 5, GPT-6.2 Sol 6, Gemini 3.5 Flash-Lite 2, Gemini 3.6 Flash 119, Claude Haiku 144-270. Düşünme tokenleri ücretlendirilir ve süreyi uzatır; modeller arasında **gizli bir karıştırıcı etken** olabilir.
2. **[Veri] Maliyet/süre farkı çok büyük.** Aynı JSON isteği: GPT-6.2 Sol 1,5-3,6 sn ve $0,00027; Gemini 4 Hydrogen **83,6 sn** ve **$0,00195** (yaklaşık 7 kat pahalı, 23-56 kat yavaş).
3. **[Veri] Yeni nesil Gemini modelleri (3.8 Flash, 4 Hydrogen) "yüksek talep" (HTTP 503) hatası verdi**; eski nesil 3.6 Flash ve 3.5 Flash-Lite vermedi. İleti iki modelde birebir aynıydı.
4. **[Veri] Token sayımları sağlayıcılar arasında karşılaştırılamaz.** Aynı metin isteği (27 / 9 / 16 giriş tokeni: Claude / Gemini / GPT) ve JSON isteği (231 / 20 / 59 / 202: Claude / Gemini 3.5 Flash-Lite / GPT / Gemini 4 Hydrogen) farklı sayılıyor: JSON isteğinde giriş tokeni 20 ile 231 arasında değişiyor. **[Yorum]** Nedeni (şemanın isteğe aktarılma biçimi, sistem içeriği, düşünme) bilinmiyor. Maliyet karşılaştırması her sağlayıcının **kendi** sayımıyla yapılmalıdır.
5. **[Veri] Talimata uyum farkı (küçük örnek).** "Tek bir Türkçe kelime yaz: selam" komutuna cevaplar: Haiku "Merhaba" (görülen 4 gözlemde), Sonnet "Selam", Gemini 3.5 Flash-Lite "selam", GPT-6.2 Sol "selam" (ham cevap metinleri ekrandan okundu, tüm koşular için kaydedilmedi). Komut belirsiz olabilir ("selam" bir örnek mi, yazılacak kelime mi?); kanıt zayıf, yalnızca bir işaret.
6. **[Veri] OpenAI hata biçimi.** Bakiye bitince HTTP 429 ve kod `credit_balance_exhausted`; geçici hız sınırı hatasından farklı sınıflanmalı (bkz. 3.3). Bu, "429 her zaman geçicidir" varsayımının sağlayıcıya özgü olarak yanlış olduğunu gösterdi.
7. **[Yorum]** Süre sınırı model başına ayarlanmalıdır; gerçek şiir/hikâye üretimi bir kelimelik istekten çok daha uzun sürer.

### 4.5 Maliyet tahmini

**[Hesap]** Bir metin için **en kötü durum** üst sınırı (çıktının tam `maxTokens` = 8192 olduğu varsayımıyla, girdi ihmal edilebilir): Claude Sonnet 5.5 yaklaşık $0,082; GPT-6.2 Sol yaklaşık $0,082; Gemini 4 Hydrogen yaklaşık $0,061; üç modelin bir metni için üst sınır yaklaşık **$0,225**. Gerçek çıktı çok daha kısa olacağı için gerçek maliyet bunun çok altındadır; **[TODO]** ilk gerçek üretimde ölçülecek (bir şiir/hikâye için gerçek çıkış tokeni ve süre).

**[Hesap]** ADR 0010'daki eski "100 metin için kabaca bir dolar altı" tahmini iki model içindi; üç model için yeniden hesaplanacak.

## 5. Sağlayıcı fiyat ve model envanteri

**[Veri]** Fiyatlar milyon token başına, $, girdi / çıktı, standart katman. Kaynaklar belge adresleriyle 10. bölümde. Fiyatlar zamanla değişir; okunma tarihi: Anthropic fiyatları 21 Kas, Google ve OpenAI fiyatları 21-22 Kas 2026.

| Aile      | Model                   | Fiyat                      | Not                                                                                     |
| --------- | ----------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| Anthropic | `claude-haiku-5-5`      | 0,10 / 0,50                | En ucuz sınıf                                                                           |
| Anthropic | `claude-sonnet-5-5`     | 2 / 10                     | **Seçildi (orta sınıf)**                                                                |
| Anthropic | `claude-opus-5-5`       | 4 / 20                     | En güçlü sınıf                                                                          |
| Google    | `gemini-3.5-flash-lite` | 0,30 / 2,50                | Ucuz sınıf, denendi                                                                     |
| Google    | `gemini-3.6-flash`      | 0,75 / 3,75                | 1 Ocak 2027'den sonra 1,50 / 7,50; denendi                                              |
| Google    | `gemini-3.8-flash`      | 0,75 / 3,75                | 1 Ocak 2027'den sonra 1,50 / 7,50; "önceki nesil"; elendi                               |
| Google    | `gemini-4-hydrogen`     | 1,50 / 7,50                | **Seçildi**; belgede tarihli zam yok                                                    |
| Google    | `gemini-4-neon`         | 3 / 15                     | Denenmedi                                                                               |
| Google    | `gemini-4-argon`        | 2 / 10, 1 Aralık'tan 4 / 20 | Denenmedi                                                                               |
| Google    | `gemini-4-carbon`       | Argon ile aynı             | "En güçlü model", denenmedi                                                             |
| OpenAI    | `gpt-6-luna`            | 0,10 / 0,50                | En verimli, ucuz sınıf adayı; denenmedi                                                 |
| OpenAI    | `gpt-6.1-terra`         | 1 / 5                      | Denenmedi                                                                               |
| OpenAI    | `gpt-6.2-sol`           | 2 / 10                     | **Seçildi (orta sınıf)**; bağlam 1,05 milyon token, en çok 128 bin çıkış token          |
| OpenAI    | `gpt-6.2-astra`         | 8 / 40                     | Amiral gemisi; (ilk duyuru sayfasında `gpt-6-astra` 10 / 50, güncel sayfa 8 / 40)       |

## 6. Sınırlılıklar ve geçerlilik tehditleri

Her biri raporda/makalede ayrıca yazılmalıdır:

1. **Sıcaklık sabitlenemiyor.** Modeller kendi varsayılan örnekleme ayarlarıyla çalışır; çıktılar değişkendir, tekrarla (replicate) ele alınır.
2. **Düşünen modeller.** Düşünme miktarı modele göre farklıdır ve ölçülmesi/kısıtlanması zordur (4.4-1).
3. **Sınıf eşleştirmesi araştırmacının kararıdır** (fiyata göre). Hydrogen, Sonnet ve Sol'dan biraz ucuzdur (3.1).
4. **Model sürümleri ve fiyatlar zamanla değişir**; sonuçlar belirli bir tarih ve model sürümüne aittir. Üretim sırasındaki model kimliği ve tarih her kayıtla saklanmalıdır.
5. **Servis kararlılığı** (yoğunluk, 503) üretimi kesintiye uğratabilir; Gemini 4 Hydrogen üretimden önce yeniden doğrulanacaktır.
6. **Taslak rubrik v0.1 yapay zekâ tarafından yazıldı**, uzman doğrulaması yok; gerçek rubrik ve etik kurul sonucu bekleniyor.
7. **Komut şablonu ve uzunluk yönergesi taslaktır**, danışmanla kesinleşecek. Komut metni sonuçları etkiler (komut mühendisliği).
8. **Yargıç yanlılığı riski:** Yapay zekâ yargıçların kendi ailesinin metnini kayırması (self-preference), uzun metni kayırması (verbosity) ve sıra etkisi; **çapraz yargıç ilkesiyle** (modelin kendi metnini kendisinin puanlamaması, İş planı 7.3) azaltılması planlanıyor. **[TODO]** Yargıç yöntemi F2'de belirlenince buraya yazılacak.
9. Denemeler küçük örnekle yapıldı (N = 2-6); istatistiksel çıkarım için yeterli değil.

## 7. Etik, gizlilik ve şeffaflık

- **[Veri]** Etik kurul sonucu bekleniyor; **onaya kadar insan puanı girişi kapalı**, insan verisi toplanmıyor.
- **[Veri]** API anahtarları yalnızca kök `.env` dosyasında; koda, commit'e, günlüğe girmez; çıktı ve hata iletilerinden `***` ile gizlenir. Anthropic ve Google anahtarları Kas 2026'da yenilenip 1,5 yıl süreli yapıldı; OpenAI anahtarının süresi **[TODO]**.
- **[Veri]** Üretilen metinler OpenAI'de saklanmaz (`store: false`).
- **[Karar]** Gerçek (ücretli) servis çağrıları kullanıcı onayıyla yapılır; her çağrı kuruşluk, toplam harcama bu belgede izlenir.
- **[TODO] Yapay zekâ kullanımı bildirimi:** Yazılım geliştirmede Claude Code (Anthropic) ile birlikte çalışıldı; taslak rubrik düzey açıklamaları da yapay zekâ tarafından yazıldı. Raporda/makalede bu kullanımın nasıl ve nereye yazılacağı danışmanla kararlaştırılmalı.
- **[TODO]** Kullanılan modellerin hizmet şartları ve üretilen metinlerin araştırmada kullanımına ilişkin sağlayıcı koşulları gözden geçirilecek.

## 8. Makale/rapor için eksik veri kontrol listesi

Bu liste, tipik bir karşılaştırmalı değerlendirme makalesinde beklenen unsurlardır; **henüz karara bağlanmadı**, ileride konuşulup doldurulacak.

- [ ] Üretim tasarımı: kaç tür × kaç tema × kaç model × kaç tekrar; toplam metin sayısı ve gerekçesi (güç analizi/örneklem büyüklüğü).
- [ ] Tema listesi ve seçim gerekçesi; komut şablonunun son hâli ve sürümü.
- [ ] Her metin için kayıt: model kimliği ve sürümü, tarih/saat, komut sürümü, token sayıları, süre, maliyet, replicate no.
- [ ] Başarısızlık oranları (model başına, hata türüne göre) ve yeniden deneme sayıları.
- [ ] Süre (medyan, yüzdelikler) ve maliyet dağılımları; metin başına gerçek maliyet.
- [ ] Yargıç tasarımı: hangi modeller, hangi komut, çapraz yargıç, kaç tekrar, sıcaklık yok; yargıç komutu ve çıktı şeması.
- [ ] Yargıç güvenilirliği: yargıçlar arası ve aynı yargıcın tekrarları arası uyum (örn. Krippendorff α / ICC / Cohen κ).
- [ ] İnsan puanı (etik kurul sonrası): insan-YZ uyumu, korelasyon, hata analizi.
- [ ] Puan dağılımları (ham ve normalleştirilmiş 0-100), kriter bazında ortalama ve yayılım.
- [ ] İstatistiksel karşılaştırma: uygun testler (örn. eşleştirilmiş/sıralı testler, karma etkili modeller), etki büyüklüğü, güven aralıkları, çoklu karşılaştırma düzeltmesi.
- [ ] Yanlılık analizleri: kendi-ailesini kayırma, uzunluk-puan ilişkisi, sıra etkisi, tema ve tür etkisi.
- [ ] Metin uzunluğu ve biçim uyumu (uzunluk yönergesine uyum, başlık/açıklama eklememe).
- [ ] Nitel örnekler: her modelden temsilî iyi/kötü metinler, yargıç gerekçeleri.
- [ ] Yeniden üretilebilirlik: kod, sürümler, komutlar, rastgelelik notları, veri paylaşımı kararı.
- [ ] Sınırlılıklar ve tehditler bölümü (6. bölüm).
- [ ] Kaynakça: model belgeleri ve fiyat sayfaları (erişim tarihleriyle), ilgili edebî değerlendirme ve YZ-yargıç (LLM-as-a-judge) literatürü **[TODO: literatür taraması yapılmadı]**.

## 9. TÜBİTAK sonuç raporu için hazır parçalar

- **Yapılan iş (F0-F1):** Katmanlı backend; sürümlü ve değişmez rubrik modülü (içe/dışa aktarma, etkinleştirme, JSON gidiş-dönüş); üç sağlayıcı için ortak sözleşme (`LLMProvider`) ve adaptörler (Claude, Gemini, GPT) ile sahte sağlayıcı; ortak hata ve yeniden deneme katmanı; sürümlü komut şablonu; üretim servisi (hata izolasyonu, maliyet sınırı, kayıt); gerçek MySQL ile veritabanı katmanı; sürekli entegrasyon.
- **Kanıt:** 275 otomatik test, yaklaşık %96 kapsam, her PR'da dört otomatik kontrol; planlanan 38 test senaryosundan T01-T12, T22, T27-T28 yazıldı ve geçti (kaynak: GitHub issue #3, `docs/IS_PLANI.md`).
- **Süreç:** Faz başına GitHub milestone ve issue (F0 #2, F1 #3 kapalı); her kararın gerekçesi `docs/adr/` altında 10 karar kaydıyla belgelendi; PR #1, #10, #12 birleşti.
- **Risk yönetimi:** Sessiz yedek yok, maliyet sınırı, anahtar güvenliği, bakiye/kota hataları, servis yoğunluğu (Gemini).
- **Bütçe/harcama:** Tüm gerçek servis denemeleri toplam yaklaşık $0,0065 (4.2). **[TODO]** Gerçek üretim ve yargıç çalışması maliyeti eklenecek.
- **Arayüz tasarımı:** Renk dili kullanıcı kararıyla Kum (%60) / Kakao (%30) / Mavi (%10), Inter yazı tipi, hap biçimli düğmeler (ADR 0008); arayüz kodlaması F3'te.
- **[TODO]** Kalan fazlar (F2-F7) tamamlandıkça bu bölüm güncellenecek.

## 10. Kaynaklar ve erişim tarihleri

Hepsi **22 Kasım 2026**'da okundu (fiyat ve model adları sonradan değişebilir):

- OpenAI fiyatlar: https://developers.openai.com/api/docs/pricing
- OpenAI modeller: https://developers.openai.com/api/docs/models ve https://developers.openai.com/api/docs/models/compare
- OpenAI GPT-6 Sol ve Luna duyurusu: https://openai.com/index/introducing-gpt-6-sol-and-luna/
- OpenAI GPT-6 Astra duyurusu: https://openai.com/index/gpt-6-astra/
- OpenAI Responses API'ye geçiş: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI yapılandırılmış çıktılar: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI akıl yürütme modelleri: https://developers.openai.com/api/docs/guides/reasoning
- Google Gemini modeller: https://aistudio.google.com/docs/models (ai.google.dev adresi buraya yönlendirir)
- Google Gemini fiyatlar: https://aistudio.google.com/docs/pricing
- Anthropic modeller ve fiyatlar: 21 Kas 2026'da belgelerden okundu. **[TODO: adres kayda geçirilmemişti, eklenecek]**

**[Veri]** Not: Bazı fiyatlar (Gemini 3.1 Flash-Lite/Pro, Gemini 2.5 ailesi) belge sayfasının özetinden okundu, doğrudan alıntı değil; raporda kullanılacaksa kaynağından yeniden doğrulanmalı. Bu belgede yalnızca doğrudan okunan satırlar tabloya alındı.

## 11. Açık sorular

- Gemini 4 Hydrogen üretimde kararlı mı? Üretimden önce yeniden denenecek (yedek: 3.6 Flash, eski nesil).
- Komut şablonu v1 metni ve uzunluk yönergeleri danışmanla kesinleşecek.
- Tema listesi sabit mi, serbest mi? (Şimdilik serbest, en çok 32 karakter.)
- Yargıç yöntemi (F2) ve kullanılacak yargıç modelleri.
- Gerçek rubrik ve etik kurul sonucu.
- Ucuz sınıf karşılaştırması eklenecek mi (`claude-haiku-5-5`, `gemini-3.5-flash-lite`, `gpt-6-luna`)?

## 12. Değişiklik günlüğü

| Tarih       | Değişiklik                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| 22 Kas 2026 | Bölüm 3.6 (sürekli entegrasyon: dört kontrolün içeriği, iş süreleri) eklendi. |
| 22 Kas 2026 | Belge oluşturuldu. Model seçimi gerekçesi (ADR 0010), R1-R8 gerçek servis verileri, fiyat envanteri, sınırlılıklar, kontrol listesi eklendi. |

---

## Ek A: ham `llm:smoke` çıktı satırları

Yalnızca ekranda görülen satırlar, düzenlenmeden (ileti metni kısaltılmış satırlar hariç). Koşu numaraları 4.2'deki gibidir.

```
R1 (21 Kas)
✔ Claude  metin claude-haiku-5-5: 1.7 sn, 27 giriş + 177 çıkış token, ≈ $0.00009
✔ Claude  json  claude-haiku-5-5: 1.8 sn, 231 giriş + 13 çıkış token, ≈ $0.00003
✔ Gemini  metin gemini-3.5-flash-lite: 1.1 sn, 9 giriş + 2 çıkış token, ≈ $0.00001
✔ Gemini  json  gemini-3.5-flash-lite: 1.7 sn, 20 giriş + 8 çıkış token, ≈ $0.00003

R2 (21 Kas, süre sınırı 30 sn)
✔ Claude  metin claude-sonnet-5-5: 1.6 sn, 27 giriş + 5 çıkış token, ≈ $0.00010
✔ Claude  json  claude-sonnet-5-5: 1.8 sn, 231 giriş + 13 çıkış token, ≈ $0.00059
✖ Gemini  metin gemini-3.8-flash: timeout (geçici)
✖ Gemini  json  gemini-3.8-flash: timeout (geçici)

R3 (21 Kas, süre sınırı uzatıldı, değeri kayda geçmedi)
✔ Claude  metin claude-sonnet-5-5: 1.5 sn, 27 giriş + 5 çıkış token, ≈ $0.00010
✔ Claude  json  claude-sonnet-5-5: 1.4 sn, 231 giriş + 13 çıkış token, ≈ $0.00059
✖ Gemini  metin gemini-3.8-flash: server_error (geçici)  ileti: HTTP 503 ... high demand
✖ Gemini  json  gemini-3.8-flash: server_error (geçici)

R4 (21 Kas)
✔ Claude  metin claude-haiku-5-5: 1.6 sn, 27 giriş + 181 çıkış token, ≈ $0.00009
✔ Claude  json  claude-haiku-5-5: 1.2 sn, 231 giriş + 13 çıkış token, ≈ $0.00003
✔ Gemini  metin gemini-3.6-flash: 6.0 sn, 9 giriş + 119 çıkış token
✔ Gemini  json  gemini-3.6-flash: 27.9 sn, 20 giriş + 140 çıkış token

R5 (22 Kas, süre sınırı 120 sn)
✔ Claude  metin claude-sonnet-5-5: 1.6 sn, 27 giriş + 5 çıkış token, ≈ $0.00010
✔ Claude  json  claude-sonnet-5-5: 2.1 sn, 231 giriş + 13 çıkış token, ≈ $0.00059
✖ Gemini  metin gemini-3.8-flash: server_error (geçici)
✖ Gemini  json  gemini-3.8-flash: timeout (geçici)  ileti: Sağlayıcı 120000 ms içinde cevap vermedi
✖ OpenAI  metin gpt-6.2-sol: rate_limit (geçici)  ileti: HTTP 429: You have no credits remaining ...
✖ OpenAI  json  gpt-6.2-sol: rate_limit (geçici)
Toplam yaklaşık maliyet: $0.00070

R6 (22 Kas, kredi yok; bakiye hatası düzeltmesinden sonra)
✔ Claude  metin claude-haiku-5-5: 2.2 sn, 27 giriş + 267 çıkış token, ≈ $0.00014
✔ Claude  json  claude-haiku-5-5: 1.3 sn, 231 giriş + 13 çıkış token, ≈ $0.00003
✔ Gemini  metin gemini-3.5-flash-lite: 1.4 sn, 9 giriş + 2 çıkış token, ≈ $0.00001
✔ Gemini  json  gemini-3.5-flash-lite: 0.9 sn, 20 giriş + 8 çıkış token, ≈ $0.00003
✖ OpenAI  metin gpt-6.2-sol: auth (kalıcı)  ileti: HTTP 429: You have no credits remaining ... [credit_balance_exhausted]
✖ OpenAI  json  gpt-6.2-sol: auth (kalıcı)
Toplam yaklaşık maliyet: $0.00020

R7 (22 Kas, kredi yüklendi)
✔ Claude  metin claude-haiku-5-5: 2.1 sn, 27 giriş + 270 çıkış token, ≈ $0.00014
✔ Claude  json  claude-haiku-5-5: 1.1 sn, 231 giriş + 13 çıkış token, ≈ $0.00003
✔ Gemini  metin gemini-3.5-flash-lite: 0.7 sn, 9 giriş + 2 çıkış token, ≈ $0.00001
✔ Gemini  json  gemini-3.5-flash-lite: 6.6 sn, 20 giriş + 8 çıkış token, ≈ $0.00003
✔ OpenAI  metin gpt-6.2-sol: 2.7 sn, 16 giriş + 6 çıkış token, ≈ $0.00009
✔ OpenAI  json  gpt-6.2-sol: 1.5 sn, 59 giriş + 15 çıkış token, ≈ $0.00027
Toplam yaklaşık maliyet: $0.00056

R8 (22 Kas, --gemini gemini-4-hydrogen --openai gpt-6.2-sol --timeout 120)
✔ Claude  metin claude-haiku-5-5: 1.6 sn, 27 giriş + 144 çıkış token, ≈ $0.00007
✔ Claude  json  claude-haiku-5-5: 1.3 sn, 231 giriş + 13 çıkış token, ≈ $0.00003
✖ Gemini  metin gemini-4-hydrogen: server_error (geçici)  ileti: HTTP 503: This model is currently experiencing high demand ...
✔ Gemini  json  gemini-4-hydrogen: 83.6 sn, 202 giriş + 219 çıkış token, ≈ $0.00195
✔ OpenAI  metin gpt-6.2-sol: 3.6 sn, 16 giriş + 6 çıkış token, ≈ $0.00009
✔ OpenAI  json  gpt-6.2-sol: 3.6 sn, 59 giriş + 15 çıkış token, ≈ $0.00027
Toplam yaklaşık maliyet: $0.00241
```
