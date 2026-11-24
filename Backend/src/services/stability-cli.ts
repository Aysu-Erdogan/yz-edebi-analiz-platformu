import { parseArgs } from 'node:util';
import { computeStability, formatStability, stabilityJson } from '../domain/stability.js';
import type { ExportRepository } from '../repositories/export.repository.js';

export interface StabilityCliDeps {
  exports: ExportRepository;
  write: (path: string, data: string) => void | Promise<void>;
  /** Oluşturulma zamanı (testte sabitlenir). */
  now?: () => Date;
}

const USAGE = [
  'Kullanım: npm run stability [-- --cikti <dosya.json>]',
  '  Aynı metne aynı hakemin tekrar puanları arasındaki sapmayı (tekrar kararlılığı) hesaplayıp ekrana yazar.',
  '  --cikti <dosya>  aynı sonucu JSON olarak dosyaya da yazar',
];

function usageError(log: (line: string) => void, message: string): number {
  log(`Hata: ${message}`);
  for (const line of USAGE) log(line);
  return 2;
}

/** `npm run stability`: tekrar kararlılığı raporu (yalnızca okur, ücretsiz). Çıkış kodu: 0 / 2 (hatalı kullanım). */
export async function runStabilityCli(
  argv: string[],
  deps: StabilityCliDeps,
  log: (line: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { cikti: { type: 'string' } } });
  } catch (error) {
    return usageError(log, error instanceof Error ? error.message : String(error));
  }

  const report = computeStability(await deps.exports.listEvaluations());
  for (const line of formatStability(report)) log(line);

  const path = parsed.values.cikti;
  if (path) {
    await deps.write(path, stabilityJson(report, (deps.now ?? (() => new Date()))()));
    log(`Sonuç yazıldı (json): ${path}`);
  }
  return 0;
}
