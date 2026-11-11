require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { GoogleGenAI } = require('@google/genai');
const { getRubricForTur } = require('../utils/rubric');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-1.5-flash-latest';

/**
 * Tema ve türe göre edebi metin üretir
 * @param {string} tema - aşk, doğa, teknoloji
 * @param {string} tur - şiir, hikaye, deneme
 * @returns {Promise<string>} Üretilen metin
 */
async function edebiMetinUret(tema, tur) {
  const temaAciklamalari = {
    aşk: 'aşk, sevda, hasret, ayrılık, tutku, romantizm',
    doğa: 'doğa, orman, deniz, dağ, gökyüzü, bahar, yapraklar, kuşlar, nehir',
    teknoloji: 'teknoloji, yapay zeka, gelecek, robotlar, dijital çağ, sanallaştırma, kodlar'
  };

  const turTalimatlari = {
    şiir: 'Duygusal, ritmik ve imagist bir şiir yaz. Türkçe edebi dil kullan. En az 8, en çok 16 dizeden oluşsun.',
    hikaye: 'Başlangıç, gelişme ve sonu olan, karakteri ve olay örgüsü gelişimi olan kısa bir hikaye yaz. 2-3 paragraf olsun.',
    deneme: 'Düşünceli, sorgulayıcı ve kişisel bir deneme yaz. Akademik olmayan, edebi bir dille, 3-4 paragraf olsun.'
  };

  const temaIcerik = temaAciklamalari[tema.toLowerCase()] || tema;
  const turTalimat = turTalimatlari[tur.toLowerCase()] || turTalimatlari['şiir'];

  const prompt = `Aşağıdaki tema ve türde özgün, Türkçe edebi bir metin üret:

**Tema:** ${tema} (${temaIcerik})
**Tür:** ${tur}

**Talimat:** ${turTalimat}

Sadece metni üret, açıklama yapma.`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error('Gemini API hatası:', error);
    throw new Error('Metin üretilirken bir hata oluştu: ' + error.message);
  }
}

/**
 * Verilen metni rubrik kriterlerine göre değerlendirir
 * @param {string} metin - Değerlendirilecek metin
 * @param {string} tur - Tür (şiir, hikaye, deneme)
 * @param {string} tema - Tema (aşk, doğa, teknoloji)
 * @returns {Promise<Object>} Değerlendirme sonucu (puanlar, yorumlar, toplam)
 */
async function metniDegerlendir(metin, tur, tema) {
  const criteria = getRubricForTur(tur);
  
  const criteriaDescriptions = criteria.map(c => 
    `- **${c.label}** (${c.key}): ${c.description}`
  ).join('\n');

  const prompt = `Aşağıdaki edebi metni, belirtilen tür ve temaya göre verilen kriterlere dayanarak **0-100 arası puanla** değerlendir.

**Tür:** ${tur}
**Tema:** ${tema}
**Metin:**
${metin}

**Değerlendirme Kriterleri:**
${criteriaDescriptions}

**Çıktı Formatı (Sadece geçerli JSON döndür, başka açıklama yapma):**
{
  "scores": {
    "kriter_key_1": puan_sayisi,
    "kriter_key_2": puan_sayisi,
    ...
  },
  "comments": {
    "kriter_key_1": "Kısa yorum (1-2 cümle)",
    "kriter_key_2": "Kısa yorum (1-2 cümle)",
    ...
  },
  "generalFeedback": "Genel değerlendirme özeti (2-3 cümle)"
}

Not: Puanlar 0-100 aralığında tam sayı olmalıdır.`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    
    // JSON parse etmeyi dene
    let result;
    try {
      // JSON bloğunu çıkar (bazı modeller markdown içinde dönebilir)
      const text = response.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = JSON.parse(text);
      }
    } catch (parseError) {
      console.error('JSON parse hatası, fallback kullanılıyor:', parseError);
      // Fallback: her kriter için 70 puan
      const fallbackScores = {};
      const fallbackComments = {};
      criteria.forEach(c => {
        fallbackScores[c.key] = 70;
        fallbackComments[c.key] = 'Otomatik değerlendirme yapılamadı, varsayılan puan atandı.';
      });
      result = {
        scores: fallbackScores,
        comments: fallbackComments,
        generalFeedback: 'Değerlendirme sırasında teknik bir sorun oluştu, varsayılan puanlar atandı.'
      };
    }

    // Eksik kriterleri tamamla
    criteria.forEach(c => {
      if (!result.scores[c.key]) result.scores[c.key] = 50;
      if (!result.comments[c.key]) result.comments[c.key] = 'Değerlendirme yapılmadı.';
    });

    // Toplam puan hesapla
    const totalScore = calculateWeightedScore(result.scores, criteria);
    
    return {
      scores: result.scores,
      comments: result.comments,
      generalFeedback: result.generalFeedback,
      totalScore,
      criteria: criteria.map(c => ({
        key: c.key,
        label: c.label,
        score: result.scores[c.key] || 0,
        comment: result.comments[c.key] || '',
        maxScore: c.maxScore,
      })),
    };
  } catch (error) {
    console.error('Değerlendirme API hatası:', error);
    // Hata durumunda fallback
    const fallbackScores = {};
    const fallbackComments = {};
    const fallbackCriteria = [];
    criteria.forEach(c => {
      fallbackScores[c.key] = 50;
      fallbackComments[c.key] = 'Değerlendirme yapılamadı.';
      fallbackCriteria.push({
        key: c.key,
        label: c.label,
        score: 50,
        comment: 'Değerlendirme yapılamadı.',
        maxScore: c.maxScore,
      });
    });
    return {
      scores: fallbackScores,
      comments: fallbackComments,
      generalFeedback: 'Değerlendirme sırasında bir hata oluştu.',
      totalScore: 50,
      criteria: fallbackCriteria,
    };
  }
}

/**
 * Ağırlıklı toplam puan hesapla
 */
function calculateWeightedScore(scores, criteria) {
  let total = 0;
  let totalWeight = 0;
  
  criteria.forEach(criterion => {
    const score = scores[criterion.key] || 0;
    total += score * criterion.weight;
    totalWeight += criterion.weight;
  });
  
  return totalWeight > 0 ? Math.round(total / totalWeight) : 0;
}

/**
 * Metin üretir VE değerlendirir (birleşik işlem)
 * @param {string} tema - aşk, doğa, teknoloji
 * @param {string} tur - şiir, hikaye, deneme
 * @returns {Promise<Object>} { metin, evaluation }
 */
async function edebiMetinUretVeDegerlendir(tema, tur) {
  const metin = await edebiMetinUret(tema, tur);
  const evaluation = await metniDegerlendir(metin, tur, tema);
  
  return {
    metin,
    evaluation,
  };
}

module.exports = { 
  edebiMetinUret, 
  metniDegerlendir, 
  edebiMetinUretVeDegerlendir 
};