const API_BASE_URL = 'http://localhost:3000/api';

/**
 * Fetch wrapper with enhanced error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Response JSON parse etmeyi dene
    let data;
    try {
      data = await response.json();
    } catch {
      // JSON değilse text olarak al
      const text = await response.text();
      data = { error: text || 'Sunucudan geçersiz yanıt alındı' };
    }

    if (!response.ok) {
      // HTTP hata durumları için detaylı hata mesajı
      const errorMessage = data.error || data.message || `HTTP ${response.status}: ${response.statusText}`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    // Network hatası (backend kapalı, CORS, DNS vb.)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError = new Error(
        'Backend sunucusuna bağlanılamıyor. Backend çalışıyor mu? (http://localhost:3000)'
      );
      networkError.isNetworkError = true;
      networkError.originalError = error;
      throw networkError;
    }
    // Diğer hataları olduğu gibi fırlat
    throw error;
  }
}

/**
 * Backend'e tema ve tür gönderip Gemini'den üretilen edebi metni ve değerlendirmesini alır
 * @param {string} tema - 'aşk', 'doğa', 'teknoloji'
 * @param {string} tur - 'şiir', 'hikaye', 'deneme'
 * @returns {Promise<{metin: string, evaluation: Object}>} Üretilen metin ve değerlendirme
 */
export async function edebiMetinUret(tema, tur) {
  try {
    const data = await apiFetch('/generate', {
      method: 'POST',
      body: JSON.stringify({ tema, tur }),
    });

    return {
      metin: data.data.metin,
      evaluation: data.data.evaluation,
    };
  } catch (error) {
    console.error('[edebiMetinUret] API Hatası:', error.message, error);
    throw error;
  }
}

/**
 * Verilen metni rubrik kriterlerine göre değerlendirir
 * @param {string} metin - Değerlendirilecek metin
 * @param {string} tur - Tür
 * @param {string} tema - Tema
 * @returns {Promise<Object>} Değerlendirme sonucu
 */
export async function metniDegerlendir(metin, tur, tema) {
  try {
    const data = await apiFetch('/evaluate', {
      method: 'POST',
      body: JSON.stringify({ metin, tur, tema }),
    });

    return data.data.evaluation;
  } catch (error) {
    console.error('[metniDegerlendir] API Hatası:', error.message, error);
    throw error;
  }
}

/**
 * Mevcut temaları ve türleri listeler
 * @returns {Promise<{temalar: string[], turler: string[]}>}
 */
export async function getTemalarVeTurler() {
  try {
    const data = await apiFetch('/themes');
    return data.data;
  } catch (error) {
    console.error('[getTemalarVeTurler] API Hatası:', error.message, error);
    throw error;
  }
}

/**
 * Belirli bir tür için rubrik kriterlerini getirir
 * @param {string} tur - Tür
 * @returns {Promise<Object>} Rubrik kriterleri
 */
export async function getRubric(tur) {
  try {
    const data = await apiFetch(`/rubric/${tur}`);
    return data.data;
  } catch (error) {
    console.error('[getRubric] API Hatası:', error.message, error);
    throw error;
  }
}

/**
 * Tüm rubrik kriterlerini getirir
 * @returns {Promise<Object>} Tüm rubrikler
 */
export async function getAllRubrics() {
  try {
    const data = await apiFetch('/rubric');
    return data.data;
  } catch (error) {
    console.error('[getAllRubrics] API Hatası:', error.message, error);
    throw error;
  }
}

/**
 * Backend sağlık kontrolü
 * @returns {Promise<boolean>} Backend erişilebilir mi
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch('http://localhost:3000/', { 
      method: 'GET',
      mode: 'cors',
    });
    return response.ok;
  } catch {
    return false;
  }
}