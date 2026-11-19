/**
 * RubricDisplay - Rubrik değerlendirme sonuçlarını gösteren bileşen
 * @param {Object} props
 * @param {Object} props.evaluation - Değerlendirme objesi
 * @param {string} props.tur - Tür
 * @param {string} props.tema - Tema
 */
export default function RubricDisplay({ evaluation, tur, tema }) {
  if (!evaluation) return null;

  const { totalScore, criteria, generalFeedback } = evaluation;

  const getScoreColor = (score) => {
    if (score >= 80) return 'score-excellent';
    if (score >= 60) return 'score-good';
    if (score >= 40) return 'score-average';
    return 'score-poor';
  };

  const getScoreLabel = (score) => {
    if (score >= 90) return 'Mükemmel';
    if (score >= 80) return 'Çok İyi';
    if (score >= 70) return 'İyi';
    if (score >= 60) return 'Orta';
    if (score >= 50) return 'Geliştirilmesi Gereken';
    return 'Yetersiz';
  };

  return (
    <section className="card rubric-panel">
      <div className="rubric-header">
        <h2>Edebi Değerlendirme Rubriği</h2>
        <div className="rubric-meta">
          <span className="rubric-badge">{tema} / {tur}</span>
        </div>
      </div>

      {/* Genel Puan */}
      <div className="rubric-total">
        <div className="total-score-circle">
          <span className="total-score-value">{totalScore}</span>
          <span className="total-score-label">/ 100</span>
        </div>
        <div className="total-score-info">
          <span className={`total-score-label-text ${getScoreColor(totalScore)}`}>
            {getScoreLabel(totalScore)}
          </span>
          <p className="total-feedback">{generalFeedback}</p>
        </div>
      </div>

      {/* Kriter Detayları */}
      <div className="rubric-criteria">
        {criteria.map((criterion) => (
          <div key={criterion.key} className="criterion-row">
            <div className="criterion-info">
              <span className="criterion-label">{criterion.label}</span>
              <span className="criterion-score">
                {criterion.score} / {criterion.maxScore}
              </span>
            </div>
            <div className="criterion-bar-container">
              <div 
                className={`criterion-bar ${getScoreColor(criterion.score)}`}
                style={{ width: `${criterion.score}%` }}
              />
            </div>
            <p className="criterion-comment">{criterion.comment}</p>
          </div>
        ))}
      </div>

      {/* Genel Puan Çubuğu */}
      <div className="rubric-total-bar">
        <div 
          className={`total-bar-fill ${getScoreColor(totalScore)}`}
          style={{ width: `${totalScore}%` }}
        />
        <span className="total-bar-text">Genel Başarı: %{totalScore}</span>
      </div>
    </section>
  );
}