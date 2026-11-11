import { useState } from 'react'
import { edebiMetinUret } from './services/api'
import AnalysisChart from './components/AnalysisChart'
import RubricDisplay from './components/RubricDisplay'

const TURLER = ['Şiir', 'Hikaye', 'Deneme']
const TEMALAR = ['Aşk', 'Doğa', 'Teknoloji']
const GRAFIK_TURLERI = ['Pasta Grafik', 'Çubuk Grafik', 'Çizgi Grafik']
const MODELLER = ['ChatGPT', 'Claude', 'Gemini']
const METIN_ALANLARI = ['Metin Alanı 1', 'Metin Alanı 2', 'Metin Alanı 3']

function OptionGroup({ legend, options, value, onChange }) {
  return (
    <fieldset className="option-group">
      <legend className="field-label">{legend}</legend>
      <div className="option-row" role="radiogroup" aria-label={legend}>
        {options.map((option) => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              className={`option-btn${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function App() {
  const [tur, setTur] = useState(TURLER[0])
  const [tema, setTema] = useState(TEMALAR[0])
  const [grafikTuru, setGrafikTuru] = useState(GRAFIK_TURLERI[0])
  const [metinler, setMetinler] = useState(['', '', ''])
  const [modeller, setModeller] = useState(['ChatGPT', 'Claude', 'Gemini'])
  const [aiMetin, setAiMetin] = useState('')
  const [aiEvaluation, setAiEvaluation] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const handleMetinChange = (index, value) => {
    setMetinler((prev) => prev.map((metin, i) => (i === index ? value : metin)))
  }

  const handleModelChange = (index, value) => {
    setModeller((prev) => prev.map((model, i) => (i === index ? value : model)))
  }

  const handleKarsilastir = async () => {
    // Mevcut karşılaştırma mantığı
    const payload = {
      tur,
      tema,
      grafikTuru,
      metinler: metinler.map((metin, index) => ({
        alan: METIN_ALANLARI[index],
        metin,
        model: modeller[index],
      })),
    }

    console.log('Karşılaştırma verileri:', payload)

    // Gemini API'den metin üret ve değerlendir
    setAiLoading(true)
    setAiError('')
    setAiMetin('')
    setAiEvaluation(null)

    try {
      // Backend beklediği parametreler: tema (küçük harf), tur (küçük harf)
      const result = await edebiMetinUret(tema.toLowerCase(), tur.toLowerCase())
      setAiMetin(result.metin)
      setAiEvaluation(result.evaluation)
      console.log('Gemini yanıtı:', result.metin)
      console.log('Değerlendirme:', result.evaluation)
    } catch (error) {
      // Network hatası özel durumu
      let errorMessage = error.message || 'Metin üretilirken hata oluştu';
      
      if (error.isNetworkError) {
        errorMessage = '⚠️ Backend sunucusuna bağlanılamıyor.\n\n' +
          'Lütfen kontrol edin:\n' +
          '1. Backend çalışıyor mu? (Backend klasöründe: npm start)\n' +
          '2. Port 3000\'de dinliyor mu?\n' +
          '3. CORS hatası olabilir - backend konsolunu kontrol edin.';
      } else if (error.status === 400) {
        errorMessage = `❌ Geçersiz istek: ${error.message}`;
      } else if (error.status === 500) {
        errorMessage = `🔴 Sunucu hatası: ${error.message}`;
      } else if (error.status === 404) {
        errorMessage = '❌ API endpoint bulunamadı. Backend rotalarını kontrol edin.';
      }
      
      setAiError(errorMessage);
      console.error('API Hatası:', error);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="navbar">
        <a className="navbar-brand" href="/">
          YZ Edebi Analiz
        </a>
        <nav className="navbar-menu" aria-label="Ana menü">
          <a href="#analiz">Analiz</a>
          <a href="#hakkinda">Hakkında</a>
        </nav>
      </header>

      <main className="app-main">
        <section className="layout" id="analiz">
          <aside className="card control-panel">
            <h2>Kontrol Paneli</h2>
            <p>Metinleri karşılaştırmadan önce tür, tema ve grafik biçimini seçin.</p>

            <OptionGroup
              legend="Değerlendirilecek Türü Seçiniz"
              options={TURLER}
              value={tur}
              onChange={setTur}
            />

            <OptionGroup
              legend="Temayı Seçiniz"
              options={TEMALAR}
              value={tema}
              onChange={setTema}
            />

            <OptionGroup
              legend="Grafik Türü Seçiniz"
              options={GRAFIK_TURLERI}
              value={grafikTuru}
              onChange={setGrafikTuru}
            />

            <button
              type="button"
              className="btn-primary compare-btn"
              onClick={handleKarsilastir}
            >
              Karşılaştır
            </button>
          </aside>

          <section className="card text-panel">
            <h2>Metin Giriş ve Model Alanı</h2>
            <p>Üç metni yan yana girin ve her birini bir yapay zeka modeline bağlayın.</p>

            <div className="text-grid">
              {METIN_ALANLARI.map((baslik, index) => (
                <article className="text-column" key={baslik}>
                  <label className="field-label" htmlFor={`metin-${index}`}>
                    {baslik}
                  </label>
                  <textarea
                    id={`metin-${index}`}
                    rows={12}
                    placeholder={`${baslik} metnini buraya yazın...`}
                    value={metinler[index]}
                    onChange={(event) => handleMetinChange(index, event.target.value)}
                  />
                  <label className="field-label" htmlFor={`model-${index}`}>
                    Model
                  </label>
                  <select
                    id={`model-${index}`}
                    value={modeller[index]}
                    onChange={(event) => handleModelChange(index, event.target.value)}
                  >
                    {MODELLER.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </section>

            {/* Analiz Grafiği Paneli */}
            <section className="card chart-panel">
              <h2>Metin Analiz Grafiği</h2>
              <p>Seçilen grafik türüne göre metinlerin kelime ve cümle sayıları karşılaştırması:</p>
              <AnalysisChart
                chartType={grafikTuru}
                metinler={metinler.map((metin, index) => ({
                  alan: METIN_ALANLARI[index],
                  metin,
                  model: modeller[index],
                }))}
                aiMetin={aiMetin}
                tema={tema}
                tur={tur}
              />
            </section>

            {/* Rubrik Değerlendirme Paneli */}
            {aiEvaluation && (
              <RubricDisplay
                evaluation={aiEvaluation}
                tur={tur}
                tema={tema}
              />
            )}

            {/* AI Yanıt Paneli */}
            <section className="card ai-panel">
              <h2>Yapay Zeka Yanıtı (Gemini)</h2>
              <p>Seçilen tür ve temaya göre Gemini tarafından üretilen edebi metin:</p>

              {aiLoading && (
                <div className="ai-loading">
                  <span className="spinner"></span>
                  <span>Metin üretiliyor...</span>
                </div>
              )}

              {aiError && (
                <div className="ai-error" role="alert">
                  <strong>Hata:</strong>
                  <pre className="error-message">{aiError}</pre>
                </div>
              )}

              {aiMetin && !aiLoading && (
                <div className="ai-response">
                  <pre className="ai-text">{aiMetin}</pre>
                  <button
                    type="button"
                    className="btn-secondary copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(aiMetin)
                      alert('Kopyalandı!')
                    }}
                  >
                    Kopyala
                  </button>
                </div>
              )}

              {!aiMetin && !aiLoading && !aiError && (
                <p className="ai-empty">Henüz bir metin üretilmedi. "Karşılaştır" butonuna basın.</p>
              )}
            </section>
          </section>
        </main>
      </div>
    )
  }

export default App
