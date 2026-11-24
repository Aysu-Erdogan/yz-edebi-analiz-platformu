import { parseArgs } from 'node:util';
import { exportCsv, exportJson } from '../domain/export.js';
import type { ExportRepository } from '../repositories/export.repository.js';

export interface ExportCliDeps {
  exports: ExportRepository;
  write: (path: string, data: string) => void | Promise<void>;
  /** Oluşturulma zamanı (testte sabitlenir). */
  now?: () => Date;
}

const USAGE = [
  'Kullanım: npm run export -- <csv|json> --cikti <dosya> [--bom] [--excel]',
  '  csv   Sayısal analiz için: kriter başına bir satır (R, SPSS, Excel)',
  '  json  Metin ve gerekçelerle tam kayıt',
  '  --bom    (yalnızca csv) dosyanın başına UTF-8 BOM yazar',
  "  --excel  (yalnızca csv) Türkçe Excel'de çift tıklayarak açmak için: BOM, noktalı virgül ve ondalık virgül",
];

function usageError(log: (line: string) => void, message: string): number {
  log(`Hata: ${message}`);
  for (const line of USAGE) log(line);
  return 2;
}

/** `npm run export -- csv|json --cikti dosya`: tüm puanlama kayıtlarını dosyaya yazar. Çıkış kodu: 0 / 2 (hatalı kullanım). */
export async function runExportCli(
  argv: string[],
  deps: ExportCliDeps,
  log: (line: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        cikti: { type: 'string' },
        bom: { type: 'boolean' },
        excel: { type: 'boolean' },
      },
    });
  } catch (error) {
    return usageError(log, error instanceof Error ? error.message : String(error));
  }

  const { positionals, values } = parsed;
  const format = positionals[0];
  if (positionals.length !== 1 || (format !== 'csv' && format !== 'json')) {
    return usageError(log, 'biçim olarak tam olarak biri verilmeli: csv ya da json');
  }
  if (!values.cikti) return usageError(log, '--cikti <dosya> zorunlu');
  if (format === 'json' && (values.bom || values.excel)) {
    return usageError(
      log,
      '--bom ve --excel yalnızca csv için (JSON başına BOM okuyucuları bozar)',
    );
  }

  const records = await deps.exports.listEvaluations();
  const data =
    format === 'csv'
      ? exportCsv(records, { bom: values.bom ?? false, excel: values.excel ?? false })
      : exportJson(records, (deps.now ?? (() => new Date()))());
  await deps.write(values.cikti, data);

  if (records.length === 0) log('Uyarı: hiç puanlama kaydı yok; dosyada yalnızca başlık var.');
  log(`${records.length} puanlama kaydı yazıldı (${format}): ${values.cikti}`);
  return 0;
}
