import { Link } from 'react-router-dom';

/**
 * Hakkında: projenin amacı, yöntemi ve sınırlılıkları. Metin sabittir (veritabanından gelmez); model ve hakem
 * adları ADR 0010 ve ADR 0011 ile birlikte güncellenir.
 */
export function About() {
  return (
    <section aria-labelledby="hakkinda-baslik" className="space-y-8">
      <div>
        <h2 id="hakkinda-baslik" className="text-3xl">
          Hakkında
        </h2>
        <p className="mt-2 max-w-3xl text-lg">
          Bu platform, üretken yapay zekâ modellerinin Türkçe şiir, hikâye ve deneme üretimindeki
          performansını değiştirilebilir bir rubrikle puanlayıp karşılaştırır. TÜBİTAK 2209-A
          projesi kapsamında, aynı zamanda bir bitirme projesi olarak geliştirilmektedir.
        </p>
      </div>

      <div>
        <h3 className="text-2xl">Yöntem</h3>
        <ol className="mt-3 max-w-3xl list-decimal space-y-3 pl-6">
          <li>
            <strong>Üretim.</strong> Aynı komutla üç modele (Claude Sonnet 5.5, Gemini 4 Hydrogen,
            GPT-6.2 Sol) aynı türde ve temada metin yazdırılır. Modeller yalnızca yazardır,
            puanlamaya karışmazlar.
          </li>
          <li>
            <strong>Puanlama.</strong> Metinleri tek ve sabit bir yapay zekâ hakem (DeepSeek Flash)
            rubrikle kriter kriter puanlar. Hakem, metnin hangi modelden geldiğini görmez; her puan
            gerekçesiyle kaydedilir. Aynı metin birkaç kez puanlanabilir, tekrarlar ortalanır.
          </li>
          <li>
            <strong>Analiz.</strong> Ölçüm birimi metindir. Modeller arasındaki fark Kruskal-Wallis
            ile, ikili farklar Mann-Whitney U (Holm düzeltmeli) ve Cliff δ etki büyüklüğüyle
            gösterilir. Eşik ya da "anlamlı" yargısı verilmez, ham değerler yazılır.
          </li>
        </ol>
      </div>

      <div>
        <h3 className="text-2xl">Sınırlılıklar</h3>
        <ul className="mt-3 max-w-3xl list-disc space-y-3 pl-6">
          <li>
            Rubrik şu an <strong>taslaktır</strong>: uzman doğrulaması yoktur. Gerçek rubrik hazır
            olduğunda yüklenir; hangi puanın hangi rubrik sürümüyle verildiği kayıtlı tutulur ve
            sürümler birbirine karıştırılmaz.
          </li>
          <li>
            Hakem bir yapay zekâdır. Türkçe edebi metni insan değerlendirmesiyle ne kadar uyumlu
            puanladığı henüz ölçülmemiştir; hakemin kendi eğilimi (sertlik, uzunluk ya da üslup
            tercihi) bütün sonuçları aynı yönde etkileyebilir.
          </li>
          <li>
            Veri seti küçüktür. Karşılaştırılan modeller fiyat ve konumlandırmaya göre
            eşleştirilmiştir; bu, yöntemin bir sınırlılığıdır.
          </li>
        </ul>
      </div>

      <div>
        <h3 className="text-2xl">Veri ve gizlilik</h3>
        <ul className="mt-3 max-w-3xl list-disc space-y-3 pl-6">
          <li>
            Hakeme yalnızca tür, tema, rubrik ve metin gönderilir; metni hangi modelin yazdığı
            gönderilmez.
          </li>
          <li>
            Karşılaştır sayfasına girdiğiniz metinler "elle girilen" olarak kaydedilir ve puanlama
            için hakem hizmetine gönderilir; model analizine girmezler. Kişisel veri girmeyin.
          </li>
          <li>
            Tüm puanlar CSV olarak indirilebilir:{' '}
            <Link to="/analiz">Sonuçlar ve Analiz sayfası</Link>.
          </li>
        </ul>
      </div>
    </section>
  );
}
