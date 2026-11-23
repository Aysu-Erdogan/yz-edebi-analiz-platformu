# ADR 0011: Puanlamayı tek sabit yapay zekâ hakem yapar (DeepSeek Flash)

**Durum:** Kabul · **Tarih:** 2026-11-23

## Bağlam

F2'nin ilk tasarımında (22 Kasım 2026, ADR 0010 sonrası) Claude, Gemini ve GPT hem **yazar** hem **hakemdi**: her hakem her metni puanlıyor, hakemle metnin yazarı aynı sağlayıcıysa puan "kendi-puanı" diye işaretleniyordu. Gerçek denemede (3 şiir × 3 hakem) bu tasarım iki sorun gösterdi: hakemlerin sertliği çok farklıydı (aynı güçlü örneğe 70 / 90 / 90) ve her puanlama üç hakem kadar ücretliydi (çağrı başına ≈ $0,0113).

23 Kasım 2026'da kullanıcı tasarımı kavramsal olarak reddetti: modeller yalnızca şiir, hikâye ve deneme **yazar**; rubrikle değerlendirmeyi modellerin kendisi değil **sistem** yapar. Seçenekler arasından "tek, sabit bir yapay zekâ hakem" seçildi.

TÜBİTAK 2209-A başvuru formu (23 Kas 2026'da okundu): puanlamayı **sistem** yapar (Hedef 1); İş Paketi 1'de "gerekli istatistiksel değerlendirmelerde Claude, OpenAI ve Gemini API servislerinden yararlanılacaktır" yazar; "yapay zekâ hakem" ifadesi ve DeepSeek formda **geçmez**; puanlayıcı pasif cümleyle bırakılmıştır ("metinler rubrik kriterlerine göre puanlanacak").

## Karar

1. **Yazarlar** ADR 0010'daki üç orta sınıf modeldir (Claude Sonnet 5.5, Gemini 4 Hydrogen, GPT-6.2 Sol). Yalnızca metin yazarlar, puanlamaya karışmazlar.
2. **Puanı sistemin tek ve sabit hakemi verir: DeepSeek Flash** (`deepseek-flash`, sağlayıcı kimliği `deepseek`). Modeli kullanıcı seçti ve API'yi kendisi satın aldı. Hakem yazarlardan biri değildir.
3. **Adaptör kuralları** (`Backend/src/providers/deepseek-provider.ts`): Chat Completions; düşünme (thinking) her zaman kapalı; puanlama (JSON) yolunda sıcaklık verilmezse 0; JSON cevap `json_object` kipinde, şema komutun sistem kısmında istenir ve cevap yine şemayla doğrulanır (uymayan cevap `failed`, uydurma puan yok: ADR 0004). Ayrıntı ve gerekçe: proje bitirme raporu belgesi bölüm 3.9.
4. **Kod çoklu hakemi hâlâ destekler** (`--hakemler a,b,c`, kendi-puanı işaretleme, `--kendini-disla`); silinmedi. Bu tasarımda kullanılmaz.
5. **Hakem modeli değişirse** (emekli olma, fiyat, kalite sorunu) bu bir **yöntem değişikliğidir**: aynı veri setinde iki hakemin puanı karıştırılmaz; eski puanlar yeniden puanlanır ya da ayrı veri seti sayılır ve raporda gerekçesiyle yazılır. Bu ilke rubrik sürümünü sabitleme kuralının (ADR 0003) hakem için karşılığıdır.

## Alternatifler

| Seçenek                                                          | Neden seçilmedi                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Üç yazar modeli de hakem (22 Kas tasarımı)                       | Kullanıcı kararı: yazar jüriye karışmaz. Ayrıca 27 metin × 3 hakem × 3 tekrar = 243 puanlama ≈ $2,7 **[Hesap]** (ölçülen ortalama $0,0113 ile) ve hakem sertliği farkı model farkıyla karışabilir                                               |
| Tek hakem olarak Claude Sonnet 5.5 ya da GPT-6.2 Sol             | Formda geçen sağlayıcılar ve çalıştığı kanıtlı, ama yazar ailelerinden biri: o ailenin metinlerinde kendini kayırma riski doğar (hakem yanlılığı literatürde belgelenmiş). Karar kullanıcıya aitti ve dördüncü bir aile seçildi **[Yorum]**   |
| Mistral, xAI Grok, Alibaba Qwen gibi diğer dördüncü aile adayları | Fiyatları doğrulanmamış toplayıcı bloglardan geldi, denenmedi, Türkçe edebi kalite kanıtı bulunamadı                                                                                                                                            |
| Tek hakem + ikinci hakemle örneklem karşılaştırması              | Ertelendi, **[TODO]** hakem doğrulaması için isteğe bağlı (aşağıda)                                                                                                                                                                             |

## Kanıt ve kanıtsız olan (23 Kas 2026, proje bitirme raporu belgesi bölüm 4.8)

- **Gerçek smoke:** güçlü örnek 75, zayıf 15; çağrı başına 2,4-4,0 sn, ≈ $0,001.
- **Pilot (3 şiir × 3 tekrar, 9/9 geçerli):** şiir ortalamaları GPT şiiri 83,3, Claude şiiri 70, Hydrogen şiiri 55; diğer üç hakemle aynı sıra. Sıcaklık 0'a rağmen bir şiirde tekrarlar 90, 80, 80 çıktı: tekrar ortalaması gerekli.
- **Kanıtlanmayan:** DeepSeek'in Türkçe edebi metni iyi değerlendirdiği ve insan puanıyla uyumu. Pilot yalnızca üç şiirlik bir yoklamadır ve taslak rubrik v0.1 ile taslak komut `judge-v1` kullanıldı.

## Sonuçlar ve riskler

- **Kendi-puanı oluşmaz** ve hakem sertliği model karşılaştırmasına karışmaz (tüm metinler aynı hakemden geçer). Bedeli: hakemin **kendi sistematik eğilimi** (sertlik, uzunluk ya da üslup tercihi, Türkçe edebi yargısındaki zayıflıklar) bütün sonuçları aynı yönde etkiler ve bu tasarımla ölçülemez. Raporda sınırlılık olarak yazılır.
- **Formdan sapma:** tek yapay zekâ hakem yöntemi ve dördüncü bir sağlayıcı formda yoktur. **[TODO]** Danışmanla teyit edilecek; raporda gerekçesiyle yazılır.
- **Veri:** DeepSeek Çin merkezli bir şirkettir. Hakeme yalnızca tür, tema, rubrik ve metin gider; metni hangi modelin yazdığı gitmez, metinler yapay zekâ üretimidir ve kişisel veri içermez. Hizmet şartları ve veri saklama koşulları **okunmadı** **[TODO]**.
- **Model kimliği:** `deepseek-flash` bir takma addır; sunucuda hangi sürüme yönlendiği DeepSeek'in kararıdır ve değişebilir. Yanıttaki gerçek model alanı şu an kaydedilmiyor **[TODO]**.
- **Fiyat:** model kaydına yoğun saat fiyatı (0,30 / 1,20 $ milyon token) yazıldı, yani maliyet tahmini üst sınırdır; yoğun olmayan saatte fiyat yarıya iner. Gerçek fatura DeepSeek panelinden karşılaştırılacak **[TODO]**.
- **Tekrar:** rubrik ya da hakem komutu değişirse pilot yinelenmelidir.
- **İstatistik tasarımı** bu karara göre sadeleşir (hakem etkisi analizde ayrı etken olmaz, tekrarlar ortalanır); henüz yazılmadı.
- **Komut satırı:** `npm run batch -- puanla` hâlâ `--hakemler` ister; varsayılan hakem ataması ayrı bir adımdır **[TODO]**.
- **Hakem doğrulaması [TODO]:** insan puanı toplanabildiğinde hakem-insan uyumu ölçülür; isteğe bağlı olarak aynı örnekler ikinci bir hakemle de puanlanıp karşılaştırılır.

## Doğrulama

24 yeni otomatik test (sahte HTTP), 24 bozmanın 24'ü yakalandı, test sayısı 448 → 472; kod commit `1ffb853`. Gerçek servis denemeleri R13 (smoke) ve R14 (pilot, iş #4): proje bitirme raporu belgesi bölüm 4.8 ve Ek A.
