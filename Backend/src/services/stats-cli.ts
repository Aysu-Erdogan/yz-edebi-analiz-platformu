import { parseArgs } from 'node:util';
import { analysisJson, analyze, formatAnalysis } from '../domain/analysis.js';
import type { ExportRepository } from '../repositories/export.repository.js';

export interface StatsCliDeps {
  exports: ExportRepository;
  write: (path: string, data: string) => void | Promise<void>;
  /** Oluşturulma zamanı (testte sabitlenir). */
  now?: () => Date;
}

const USAGE = [
  'Kullanım: npm run stats [-- --cikti <dosya.json>]',
  '  Yazar modelleri karşılaştırır: betimsel değerler, Kruskal-Wallis ve ikili Mann-Whitney (Holm düzeltmeli, Cliff δ).',
  '  --cikti <dosya>  aynı sonucu JSON olarak dosyaya da yazar',
  '  --tema a,b,c     yalnızca bu temalı metinleri analiz eder (deneme verisini dışarıda bırakmak için)',
];

function usageError(log: (line: string) => void, message: string): number {
  log(`Hata: ${message}`);
  for (const line of USAGE) log(line);
  return 2;
}

/** `npm run stats`: model karşılaştırma istatistikleri (yalnızca okur, ücretsiz). Çıkış kodu: 0 / 2 (hatalı kullanım). */
export async function runStatsCli(
  argv: string[],
  deps: StatsCliDeps,
  log: (line: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { cikti: { type: 'string' }, tema: { type: 'string' } },
    });
  } catch (error) {
    return usageError(log, error instanceof Error ? error.message : String(error));
  }

  // Deneme verisi (örn. Sonbahar şiirleri) nihai veri setine karışmasın: yalnızca verilen temalar.
  const themes = parsed.values.tema
    ?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const records = await deps.exports.listEvaluations();
  const conditions = analyze(
    themes?.length ? records.filter((r) => themes.includes(r.theme)) : records,
  );
  for (const line of formatAnalysis(conditions)) log(line);

  const path = parsed.values.cikti;
  if (path) {
    await deps.write(path, analysisJson(conditions, (deps.now ?? (() => new Date()))()));
    log(`Sonuç yazıldı (json): ${path}`);
  }
  return 0;
}
