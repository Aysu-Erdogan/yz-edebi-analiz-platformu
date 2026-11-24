import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { RubricService } from './rubric.service.js';

export interface RubricCliDeps {
  rubrics: RubricService;
  /** Dosya içeriğini metin olarak okur (testte sahte). */
  read: (path: string) => string;
}

const USAGE = [
  'Kullanım: npm run rubric -- <komut>',
  '  listele                                  kayıtlı rubrikleri gösterir',
  '  yukle <dosya.json>... [--etkinlestir]    rubrik yükler; dosya tek rubrik ya da rubrik dizisi olabilir',
  '  --etkinlestir  yüklenenleri etkinleştirir (aynı türdeki önceki etkin rubrik arşivlenir)',
];

function usageError(log: (line: string) => void, message: string): number {
  log(`Hata: ${message}`);
  for (const line of USAGE) log(line);
  return 2;
}

function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * `npm run rubric -- listele | yukle <dosya>... [--etkinlestir]`: gerçek rubrik geldiğinde onu sisteme yükler.
 * Yüklenen rubrik yeni sürümdür; eski puanlar yerinde kalır, yeniden puanlama `batch puanla` ile yapılır (T21).
 * Çıkış kodu: 0 / 1 (bir yükleme başarısız) / 2 (hatalı kullanım).
 */
export async function runRubricCli(
  argv: string[],
  deps: RubricCliDeps,
  log: (line: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { etkinlestir: { type: 'boolean' } },
    });
  } catch (error) {
    return usageError(log, describeError(error));
  }
  const [command, ...files] = parsed.positionals;
  const activate = parsed.values.etkinlestir ?? false;

  if (command === 'listele' && files.length === 0 && !activate) {
    const all = await deps.rubrics.listRubrics();
    if (all.length === 0) log('Kayıtlı rubrik yok.');
    for (const r of all) {
      log(
        `#${r.id} ${r.genre} ${r.version} · ${r.status} · ${r.usedAt ? 'kullanıldı' : 'kullanılmadı'}`,
      );
    }
    return 0;
  }
  if (command !== 'yukle') {
    return usageError(
      log,
      command ? `bilinmeyen komut ya da fazladan sözcük: ${command}` : 'komut verilmedi',
    );
  }
  if (files.length === 0) return usageError(log, 'yukle için en az bir dosya verilmeli');

  let failed = false;
  let activated = false;
  for (const file of files) {
    let items: unknown[];
    try {
      const parsedJson: unknown = JSON.parse(deps.read(file));
      items = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
    } catch (error) {
      failed = true;
      log(
        `✖ ${file}: ${error instanceof SyntaxError ? 'geçerli JSON değil' : describeError(error)}`,
      );
      continue;
    }
    for (const item of items) {
      try {
        const stored = await deps.rubrics.importRubric(item);
        if (activate) await deps.rubrics.activateRubric(stored.id);
        activated ||= activate;
        log(
          `✔ ${stored.genre} ${stored.version} yüklendi (id ${stored.id})${activate ? ' ve etkinleştirildi' : ''}`,
        );
      } catch (error) {
        failed = true;
        const message = error instanceof AppError ? error.message : describeError(error);
        log(`✖ ${file}: ${message}`);
      }
    }
  }
  if (activated) {
    log(
      'Eski metinleri yeni rubrikle yeniden puanlamak için: npm run batch -- puanla --metinler hepsi --hakemler deepseek-flash --tekrar 3 (plan gösterir; --calistir ile gerçek çalıştırma).',
    );
  }
  return failed ? 1 : 0;
}
