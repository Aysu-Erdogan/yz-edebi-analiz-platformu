const express = require('express');
const router = express.Router();
const { edebiMetinUret, metniDegerlendir, edebiMetinUretVeDegerlendir } = require('../services/geminiService');
const { getRubricForTur, getAllRubrics } = require('../utils/rubric');

/**
 * POST /api/generate
 * Tema ve türe göre edebi metin üretir VE rubrik değerlendirmesi yapar
 * Body: { tema: "aşk|doğa|teknoloji", tur: "şiir|hikaye|deneme" }
 */
router.post('/generate', async (req, res) => {
  try {
    const { tema, tur } = req.body;

    // Validasyon
    const gecerliTemalar = ['aşk', 'doğa', 'teknoloji'];
    const gecerliTurler = ['şiir', 'hikaye', 'deneme'];

    // Türkçe karakter sorunu için locale-aware karşılaştırma
    const normalizeTr = (str) => str.toLocaleLowerCase('tr-TR');

    if (!tema || !tur) {
      return res.status(400).json({
        success: false,
        error: 'tema ve tur alanları zorunludur'
      });
    }

    if (!gecerliTemalar.some(t => normalizeTr(t) === normalizeTr(tema))) {
      return res.status(400).json({
        success: false,
        error: `Geçersiz tema. Geçerli temalar: ${gecerliTemalar.join(', ')}`
      });
    }

    if (!gecerliTurler.some(t => normalizeTr(t) === normalizeTr(tur))) {
      return res.status(400).json({
        success: false,
        error: `Geçersiz tür. Geçerli türler: ${gecerliTurler.join(', ')}`
      });
    }

    // Metin üret ve değerlendir
    const result = await edebiMetinUretVeDegerlendir(tema, tur);

    res.json({
      success: true,
      data: {
        tema,
        tur,
        metin: result.metin,
        evaluation: result.evaluation,
      }
    });
  } catch (error) {
    console.error('API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Sunucu hatası oluştu'
    });
  }
});

/**
 * POST /api/evaluate
 * Verilen metni rubrik kriterlerine göre değerlendirir
 * Body: { metin: "...", tur: "şiir|hikaye|deneme", tema: "aşk|doğa|teknoloji" }
 */
router.post('/evaluate', async (req, res) => {
  try {
    const { metin, tur, tema } = req.body;

    if (!metin || !tur || !tema) {
      return res.status(400).json({
        success: false,
        error: 'metin, tur ve tema alanları zorunludur'
      });
    }

    const evaluation = await metniDegerlendir(metin, tur, tema);

    res.json({
      success: true,
      data: {
        tur,
        tema,
        evaluation,
      }
    });
  } catch (error) {
    console.error('Değerlendirme API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Sunucu hatası oluştu'
    });
  }
});

/**
 * GET /api/themes
 * Mevcut temaları ve türleri listeler
 */
router.get('/themes', (req, res) => {
  res.json({
    success: true,
    data: {
      temalar: ['aşk', 'doğa', 'teknoloji'],
      turler: ['şiir', 'hikaye', 'deneme']
    }
  });
});

/**
 * GET /api/rubric/:tur
 * Belirli bir tür için rubrik kriterlerini döndürür
 */
router.get('/rubric/:tur', (req, res) => {
  try {
    const { tur } = req.params;
    const criteria = getRubricForTur(tur);
    
    res.json({
      success: true,
      data: {
        tur,
        criteria,
      }
    });
  } catch (error) {
    console.error('Rubrik API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Sunucu hatası oluştu'
    });
  }
});

/**
 * GET /api/rubric
 * Tüm rubrik kriterlerini döndürür
 */
router.get('/rubric', (req, res) => {
  try {
    const allRubrics = getAllRubrics();
    
    res.json({
      success: true,
      data: allRubrics,
    });
  } catch (error) {
    console.error('Rubrik API hatası:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Sunucu hatası oluştu'
    });
  }
});

module.exports = router;