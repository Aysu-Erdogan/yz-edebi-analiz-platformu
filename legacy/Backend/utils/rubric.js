/**
 * Edebi Metin Değerlendirme Rubrik Yapılandırması
 * Her edebi tür için özel kriterler ve ağırlıklar
 */

const RUBRIC_CRITERIA = {
  şiir: [
    {
      key: 'imgeGucu',
      label: 'İmge Gücü',
      description: 'Metafor, benzetme, sembol gibi edebi sanatların kullanım kalitesi ve yaratıcılığı',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'ritimVeAhenk',
      label: 'Ritim ve Ahenk',
      description: 'Ölçü, kafiye, ritmik akış ve müzikal uyum',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'duyguAktarimi',
      label: 'Duygu Aktarımı',
      description: 'Okuyucuya hissiyat aktarma gücü, içtenlik ve etki alanı',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'ozgunluk',
      label: 'Özgünlük',
      description: 'Klişelerden uzak, benzersiz bir ses ve bakış açısı',
      weight: 1.0,
      maxScore: 100,
    },
  ],
  hikaye: [
    {
      key: 'olayOrgusu',
      label: 'Olay Örgüsü',
      description: 'Başlangıç-gelişme-son yapısının tutarlılığı, sürpriz unsurları ve tempolu anlatım',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'karakterTutarliligi',
      label: 'Karakter Tutarlılığı',
      description: 'Karakterlerin psikolojik derinliği, gelişimi ve davranış tutarlılığı',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'atmosfer',
      label: 'Atmosfer',
      description: 'Mekan, zaman ve havanın hissiyatı, okuyucuyu çevreleme gücü',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'temaIslenisi',
      label: 'Tema İşlenişi',
      description: 'Ana temanın derinlemesine işlenmesi, alt temalar ve mesajın netliği',
      weight: 1.0,
      maxScore: 100,
    },
  ],
  deneme: [
    {
      key: 'dusunselDerinlik',
      label: 'Düşünsel Derinlik',
      description: 'Konunun çok boyutlu analizi, sorgulama derinliği ve özgün bakış açısı',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'kisiselUslub',
      label: 'Kişisel Üslup',
      description: 'Yazarın benzersiz sesi, akıcı anlatım ve edebi kalite',
      weight: 1.0,
      maxScore: 100,
    },
    {
      key: 'dilselDogrukluk',
      label: 'Dilsel Doğruluk',
      description: 'Dilbilgisi, imla, noktalama kurallarına uygunluk ve kelime hazinesi zenginliği',
      weight: 1.0,
      maxScore: 100,
    },
  ],
};

/**
 * Türkçe karakterlerle case-insensitive karşılaştırma
 */
function normalizeTr(str) {
  return str.toLocaleLowerCase('tr-TR');
}

/**
 * Verilen tür için rubrik kriterlerini döndürür
 * @param {string} tur - 'şiir', 'hikaye', 'deneme'
 * @returns {Array} Kriter listesi
 */
function getRubricForTur(tur) {
  const normalizedTur = normalizeTr(tur);
  return RUBRIC_CRITERIA[normalizedTur] || RUBRIC_CRITERIA['şiir'];
}

/**
 * Tüm rubrik kriterlerini döndürür
 * @returns {Object} Tüm türler için kriterler
 */
function getAllRubrics() {
  return RUBRIC_CRITERIA;
}

/**
 * Puan hesaplama yardımcıları
 */
function calculateTotalScore(scores, criteria) {
  let total = 0;
  let totalWeight = 0;
  
  criteria.forEach(criterion => {
    const score = scores[criterion.key] || 0;
    total += score * criterion.weight;
    totalWeight += criterion.weight;
  });
  
  return totalWeight > 0 ? Math.round(total / totalWeight) : 0;
}

function getScoreLabel(score) {
  if (score >= 90) return 'Mükemmel';
  if (score >= 80) return 'Çok İyi';
  if (score >= 70) return 'İyi';
  if (score >= 60) return 'Orta';
  if (score >= 50) return 'Geliştirilmesi Gereken';
  return 'Yetersiz';
}

function getScoreColor(score) {
  if (score >= 80) return '#10b981'; // green
  if (score >= 60) return '#f59e0b'; // amber
  if (score >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
}

module.exports = {
  RUBRIC_CRITERIA,
  getRubricForTur,
  getAllRubrics,
  calculateTotalScore,
  getScoreLabel,
  getScoreColor,
  normalizeTr,
};