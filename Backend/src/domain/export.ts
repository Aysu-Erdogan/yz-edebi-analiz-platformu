/**
 * Dışa aktarma: puanlama kayıtlarını CSV (R/SPSS/Excel için sayısal analiz) ve JSON (metin ve gerekçelerle tam
 * kayıt) olarak biçimlendirir. Saf işlevler: veritabanına dokunmaz, çıktıyı metin olarak döner.
 */

/** Dışa aktarılacak tek bir puanlama kaydı (başarılı ya da başarısız), ilişkili bilgilerle birlikte. */
export interface ExportEvaluation {
  evaluationId: number;
  textId: number;
  genre: string;
  theme: string;
  textBody: string;
  /** Metni üreten model (üretim kaydından); elle girilen metinde yok. */
  author: { provider: string; modelId: string } | null;
  /** Elle girilen metnin etiketi. */
  label: string | null;
  /** Hakem, `sağlayıcı/model` biçiminde. */
  judge: string;
  replicateNo: number;
  status: string;
  error: string | null;
  totalScore: number | null;
  rubricVersion: string;
  /** Rubriğin kaynak notu; taslak rubrikte "uzman doğrulaması yok" uyarısını taşır. */
  rubricNote: string | null;
  judgeTemplateVersion: string | null;
  generationTemplateVersion: string | null;
  attempts: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  scores: { criterionKey: string; score: number; comment: string | null }[];
}

export interface CsvOptions {
  /** Dosyanın başına UTF-8 BOM yazar (Excel Türkçe karakterleri doğru okusun). */
  bom?: boolean;
  /** Türkçe Excel'de çift tıklayınca açılması için: BOM + noktalı virgül ayırıcı + ondalık virgül. */
  excel?: boolean;
}

const HEADER = [
  'puanlama_id',
  'metin_id',
  'tur',
  'tema',
  'yazar',
  'hakem',
  'tekrar_no',
  'kendi_puani',
  'durum',
  'hata',
  'rubrik_surumu',
  'rubrik_notu',
  'hakem_komut_surumu',
  'uretim_komut_surumu',
  'deneme',
  'giris_token',
  'cikis_token',
  'sure_ms',
  'kriter',
  'puan',
  'toplam_puan',
];

/** UTF-8 BOM (U+FEFF). Kodla üretilir ki kaynakta görünmez bir karakter durmasın. */
const BOM = String.fromCharCode(0xfeff);

/** Yazar ve hakem aynı sağlayıcıdansa true; yazar bilinmiyorsa (elle girilen metin) null. */
const isSelfScore = (record: ExportEvaluation): boolean | null =>
  record.author ? record.author.provider === record.judge.split('/')[0] : null;

const authorName = (record: ExportEvaluation): string | null =>
  record.author ? `${record.author.provider}/${record.author.modelId}` : record.label;

// Excel bu karakterlerle başlayan hücreyi formül sayar; dışarıdan gelen metin (hata iletisi, etiket) için önlem.
const FORMULA_START = /^[=+\-@\t\r]/;

function textCell(value: string | null, separator: string): string {
  if (value === null) return '';
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  const needsQuotes = /["\r\n]/.test(safe) || safe.includes(separator);
  return needsQuotes ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportCsv(records: ExportEvaluation[], options: CsvOptions = {}): string {
  const separator = options.excel ? ';' : ',';
  const decimal = options.excel ? ',' : '.';
  const text = (value: string | null) => textCell(value, separator);
  const num = (value: number | null) => (value === null ? '' : String(value).replace('.', decimal));
  const row = (cells: string[]) => `${cells.join(separator)}\r\n`;

  let csv = row(HEADER);
  for (const r of records) {
    const self = isSelfScore(r);
    const head = [
      num(r.evaluationId),
      num(r.textId),
      text(r.genre),
      text(r.theme),
      text(authorName(r)),
      text(r.judge),
      num(r.replicateNo),
      self === null ? '' : self ? 'evet' : 'hayir',
      text(r.status),
      text(r.error),
      text(r.rubricVersion),
      text(r.rubricNote),
      text(r.judgeTemplateVersion),
      text(r.generationTemplateVersion),
      num(r.attempts),
      num(r.inputTokens),
      num(r.outputTokens),
      num(r.latencyMs),
    ];
    // Başarısız puanlamada kriter satırı yoktur: tek satır, kriter ve puan boş (uydurma puan yok).
    if (r.scores.length === 0) csv += row([...head, '', '', num(r.totalScore)]);
    for (const s of r.scores) {
      csv += row([...head, text(s.criterionKey), num(s.score), num(r.totalScore)]);
    }
  }
  return (options.bom || options.excel ? BOM : '') + csv;
}

export function exportJson(records: ExportEvaluation[], now: Date): string {
  return JSON.stringify(
    {
      olusturulma: now.toISOString(),
      kayitlar: records.map((r) => ({
        puanlamaId: r.evaluationId,
        metinId: r.textId,
        tur: r.genre,
        tema: r.theme,
        metin: r.textBody,
        yazar: authorName(r),
        hakem: r.judge,
        tekrarNo: r.replicateNo,
        kendiPuani: isSelfScore(r),
        durum: r.status,
        hata: r.error,
        rubrik: { surum: r.rubricVersion, not: r.rubricNote },
        hakemKomutSurumu: r.judgeTemplateVersion,
        uretimKomutSurumu: r.generationTemplateVersion,
        deneme: r.attempts,
        girisToken: r.inputTokens,
        cikisToken: r.outputTokens,
        sureMs: r.latencyMs,
        toplamPuan: r.totalScore,
        puanlar: r.scores.map((s) => ({
          kriter: s.criterionKey,
          puan: s.score,
          gerekce: s.comment,
        })),
      })),
    },
    null,
    2,
  );
}
