import { describe, expect, it } from 'vitest';
import { exportCsv, exportJson, type ExportEvaluation } from '../src/domain/export.js';

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 okuyucusu: dışa aktarılan metni geri çözer (tırnaklı virgül, çift tırnak, satır sonu). */
function parseCsv(text: string, sep = ','): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

/** Başlık satırına göre her satırı nesneye çevirir. */
function table(text: string, sep = ','): Record<string, string>[] {
  const [header = [], ...rows] = parseCsv(text, sep);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const ok: ExportEvaluation = {
  evaluationId: 1,
  textId: 10,
  genre: 'siir',
  theme: 'Sonbahar',
  textBody: 'Yaprak düşer, gönül şişer.\nİkinci satır.',
  author: { provider: 'openai', modelId: 'gpt-6.2-sol' },
  label: null,
  judge: 'openai/gpt-6.2-sol',
  replicateNo: 1,
  status: 'succeeded',
  error: null,
  totalScore: 66.5,
  rubricVersion: '0.1-taslak',
  rubricNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok.',
  judgeTemplateVersion: 'v1',
  generationTemplateVersion: 'v1',
  attempts: 1,
  inputTokens: 1232,
  outputTokens: 483,
  latencyMs: 11710,
  scores: [
    { criterionKey: 'imgeGucu', score: 5, comment: 'güçlü, canlı' },
    { criterionKey: 'ritimAhenk', score: 4, comment: null },
    { criterionKey: 'ozgunluk', score: 3, comment: 'orta' },
  ],
};

const failed: ExportEvaluation = {
  ...ok,
  evaluationId: 2,
  judge: 'google/gemini-4-hydrogen',
  status: 'failed',
  error: 'server_error: HTTP 503: "yoğun talep", sonra deneyin.',
  totalScore: null,
  attempts: 1,
  inputTokens: null,
  outputTokens: null,
  latencyMs: 900,
  scores: [],
};

describe('dışa aktarma: CSV', () => {
  it('başlık satırı sabit ve sıralıdır', () => {
    const [header] = parseCsv(exportCsv([]));
    expect(header).toEqual([
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
    ]);
  });

  it('kayıt yoksa yalnızca başlık yazılır', () => {
    expect(parseCsv(exportCsv([]))).toHaveLength(1);
  });

  it('başarılı puanlama kriter başına bir satır olur; toplam her satırda tekrarlanır', () => {
    const rows = table(exportCsv([ok]));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.kriter, r.puan, r.toplam_puan])).toEqual([
      ['imgeGucu', '5', '66.5'],
      ['ritimAhenk', '4', '66.5'],
      ['ozgunluk', '3', '66.5'],
    ]);
    expect(rows[0]).toMatchObject({
      puanlama_id: '1',
      metin_id: '10',
      tur: 'siir',
      tema: 'Sonbahar',
      yazar: 'openai/gpt-6.2-sol',
      hakem: 'openai/gpt-6.2-sol',
      tekrar_no: '1',
      durum: 'succeeded',
      hata: '',
      rubrik_surumu: '0.1-taslak',
      rubrik_notu: 'GEÇİCİ TASLAK: uzman doğrulaması yok.',
      hakem_komut_surumu: 'v1',
      uretim_komut_surumu: 'v1',
      deneme: '1',
      giris_token: '1232',
      cikis_token: '483',
      sure_ms: '11710',
    });
  });

  it('başarısız puanlama tek satırdır: hata var, kriter ve puan boş (uydurma puan yok)', () => {
    const rows = table(exportCsv([failed]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      durum: 'failed',
      hata: 'server_error: HTTP 503: "yoğun talep", sonra deneyin.',
      kriter: '',
      puan: '',
      toplam_puan: '',
      giris_token: '',
      cikis_token: '',
      sure_ms: '900',
    });
  });

  it('kendi-puanı: yazar ve hakem aynı sağlayıcıysa evet, değilse hayir, yazar bilinmiyorsa boş', () => {
    const other = { ...ok, scores: [], judge: 'anthropic/claude-sonnet-5-5' };
    const manual = { ...ok, scores: [], author: null, label: 'Elle girildi' };
    const rows = table(exportCsv([{ ...ok, scores: [] }, other, manual]));
    expect(rows.map((r) => r.kendi_puani)).toEqual(['evet', 'hayir', '']);
    expect(rows[2]?.yazar).toBe('Elle girildi');
  });

  it('Türkçe karakterler, virgül, çift tırnak ve satır sonu bozulmadan geri okunur', () => {
    const theme = 'Gönül, "ışık"\nİşçiğ';
    const rows = table(exportCsv([{ ...ok, theme, scores: [] }]));
    expect(rows[0]?.tema).toBe(theme);
  });

  it('yalnızca satır sonu içeren hücre de tırnaklanır (satır sayısı bozulmaz)', () => {
    const error = 'satır1\nsatır2';
    const csv = exportCsv([{ ...failed, error }]);
    const rows = table(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hata).toBe(error);
    // Çıplak satır sonu okuyucuda satırı bölebilir (Excel LF'yi satır sonu sayar): tırnak içinde olmalı.
    expect(csv).toContain(`"${error}"`);
  });

  it('satır sonu CRLF olur ve dosya satır sonuyla biter', () => {
    const csv = exportCsv([ok]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(5); // başlık + 3 satır + sondaki boş parça
  });

  it('formül olarak yorumlanabilecek metin hücreleri (=, +, -, @) tek tırnakla başlatılır', () => {
    const cells = ['=1+1', '+1', '-1', '@sum', '\tx'];
    for (const error of cells) {
      const rows = table(exportCsv([{ ...failed, error }]));
      expect(rows[0]?.hata).toBe(`'${error}`);
    }
    // Sıradan metin ve sayılara dokunulmaz.
    expect(table(exportCsv([{ ...failed, error: 'normal' }]))[0]?.hata).toBe('normal');
  });

  it('BOM yalnızca istenince yazılır', () => {
    expect(exportCsv([ok]).startsWith(BOM)).toBe(false);
    expect(exportCsv([ok], { bom: true }).startsWith(BOM)).toBe(true);
  });

  it('excel kipi: BOM, noktalı virgül ayırıcı ve ondalık virgül', () => {
    const csv = exportCsv([{ ...ok, scores: ok.scores.slice(0, 1) }], { excel: true });
    expect(csv.startsWith(BOM)).toBe(true);
    const rows = table(csv, ';');
    expect(rows[0]?.puanlama_id).toBe('1');
    expect(rows[0]?.toplam_puan).toBe('66,5');
    expect(rows[0]?.giris_token).toBe('1232');
  });

  it('excel kipinde ayırıcıyı içeren hücre tırnaklanır', () => {
    const csv = exportCsv([{ ...failed, error: 'a;b' }], { excel: true });
    expect(table(csv, ';')[0]?.hata).toBe('a;b');
  });
});

describe('dışa aktarma: JSON', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');

  it('üst düzey: oluşturulma zamanı ve kayıtlar; metin ve gerekçeler içinde', () => {
    const json = JSON.parse(exportJson([ok], now));
    expect(json.olusturulma).toBe('2026-11-23T12:00:00.000Z');
    expect(json.kayitlar).toHaveLength(1);
    expect(json.kayitlar[0]).toEqual({
      puanlamaId: 1,
      metinId: 10,
      tur: 'siir',
      tema: 'Sonbahar',
      metin: 'Yaprak düşer, gönül şişer.\nİkinci satır.',
      yazar: 'openai/gpt-6.2-sol',
      hakem: 'openai/gpt-6.2-sol',
      tekrarNo: 1,
      kendiPuani: true,
      durum: 'succeeded',
      hata: null,
      rubrik: { surum: '0.1-taslak', not: 'GEÇİCİ TASLAK: uzman doğrulaması yok.' },
      hakemKomutSurumu: 'v1',
      uretimKomutSurumu: 'v1',
      deneme: 1,
      girisToken: 1232,
      cikisToken: 483,
      sureMs: 11710,
      toplamPuan: 66.5,
      puanlar: [
        { kriter: 'imgeGucu', puan: 5, gerekce: 'güçlü, canlı' },
        { kriter: 'ritimAhenk', puan: 4, gerekce: null },
        { kriter: 'ozgunluk', puan: 3, gerekce: 'orta' },
      ],
    });
  });

  it('başarısız kayıt: hata var, puan listesi boş, toplam null', () => {
    const [record] = JSON.parse(exportJson([failed], now)).kayitlar;
    expect(record).toMatchObject({
      durum: 'failed',
      hata: 'server_error: HTTP 503: "yoğun talep", sonra deneyin.',
      toplamPuan: null,
      puanlar: [],
    });
  });

  it('yazar bilinmiyorsa kendiPuani null, yazar elle girilen etikettir', () => {
    const [record] = JSON.parse(
      exportJson([{ ...ok, author: null, label: 'Elle girildi' }], now),
    ).kayitlar;
    expect(record).toMatchObject({ kendiPuani: null, yazar: 'Elle girildi' });
  });

  it('kayıt yoksa boş liste', () => {
    expect(JSON.parse(exportJson([], now)).kayitlar).toEqual([]);
  });
});
