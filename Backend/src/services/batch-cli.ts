import { ZodError } from 'zod';
import { estimateCostUsd } from '../domain/model-params.js';
import { judgeVars } from '../domain/judge.js';
import { generationVars, renderPrompt } from '../domain/prompt.js';
import { GENRES, type Genre } from '../domain/rubric.js';
import { AppError } from '../lib/errors.js';
import { estimateTokens } from '../providers/provider.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ResilienceOptions } from '../providers/resilient-provider.js';
import type { EvaluationRepository } from '../repositories/evaluation.repository.js';
import type { GenerationRepository } from '../repositories/generation.repository.js';
import type { JobRepository, StoredJob } from '../repositories/job.repository.js';
import type {
  ProviderModelRecord,
  ProviderModelRepository,
} from '../repositories/provider-model.repository.js';
import {
  EVALUATE_BATCH,
  createEvaluateBatchHandler,
  prepareEvaluateBatch,
} from './evaluate-batch.js';
import { createEvaluationService } from './evaluation.service.js';
import {
  GENERATE_BATCH,
  createGenerateBatchHandler,
  prepareGenerateBatch,
} from './generate-batch.js';
import { createGenerationService } from './generation.service.js';
import { createJobRunner } from './job-runner.js';
import type { PromptTemplateService } from './prompt-template.service.js';
import type { RubricService } from './rubric.service.js';

/** Hatalı komut satırı: kullanıcıya açıklama ve kullanım özeti gösterilir, çıkış kodu 2. */
export class UsageError extends Error {}

const COMMANDS = ['uret', 'puanla', 'devam', 'durum'] as const;
type Command = (typeof COMMANDS)[number];
const BOOLEAN_FLAGS = new Set(['calistir', 'kendini-disla']);
const VALUE_FLAGS = new Set([
  'konular',
  'modeller',
  'tekrar',
  'butce',
  'metinler',
  'tur',
  'hakemler',
]);
const COMMAND_FLAGS: Record<Command, string[]> = {
  uret: ['konular', 'modeller', 'tekrar', 'butce', 'calistir'],
  puanla: ['metinler', 'tur', 'hakemler', 'tekrar', 'butce', 'kendini-disla', 'calistir'],
  devam: [],
  durum: [],
};

export const USAGE = [
  'Kullanım: npm run batch -- <komut> [seçenekler]',
  '  uret    --konular "siir:Sonbahar,hikaye:Deniz" --modeller a,b,c [--tekrar 3] [--butce 2] [--calistir]',
  '  puanla  --metinler hepsi|1-27|3,5 --hakemler a,b,c [--tur siir] [--tekrar 3] [--butce 2] [--kendini-disla] [--calistir]',
  '  devam   yarım kalan ya da bekleyen işleri kaldığı yerden sürdürür',
  '  durum   işlerin durumunu gösterir',
  'Varsayılan olarak yalnızca PLAN gösterilir, hiçbir çağrı yapılmaz; gerçekten başlatmak için --calistir ekleyin.',
].join('\n');

export interface ParsedArgs {
  command: Command;
  options: Record<string, string | true>;
}

export function parseBatchArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) throw new UsageError('Komut verilmedi.');
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(`Bilinmeyen komut: ${command}`);
  }
  const options: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('--')) throw new UsageError(`Beklenmeyen argüman: ${token}`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      options[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new UsageError(`Bilinmeyen seçenek: ${token}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${token} için değer gerekli`);
    }
    options[name] = value;
    i++;
  }
  return { command: command as Command, options };
}

/** `tür:tema,tür:tema` biçiminden konular. Tema ilk iki noktadan sonrasıdır (virgül içeremez). */
export function parseTopics(text: string): { genre: Genre; theme: string }[] {
  const topics = text.split(',').map((part) => {
    const index = part.indexOf(':');
    const genre = part.slice(0, index).trim();
    const theme = part.slice(index + 1).trim();
    if (index < 0 || theme === '')
      throw new UsageError(`Konu "tür:tema" biçiminde olmalı: "${part.trim()}"`);
    if (!(GENRES as readonly string[]).includes(genre)) {
      throw new UsageError(
        `Bilinmeyen tür "${genre}" (siir, hikaye ya da deneme olmalı, Türkçe karakter yok)`,
      );
    }
    return { genre: genre as Genre, theme };
  });
  return topics;
}

const MAX_RANGE = 5000;

/** `hepsi`, `5`, `3,5,9` ya da `1-27` (karışık da olur: `1-3,7`). Tekrarlar atılır. */
export function parseIdSelection(text: string): { all: true } | { ids: number[] } {
  if (text.trim() === 'hepsi') return { all: true };
  const ids: number[] = [];
  for (const piece of text.split(',').map((p) => p.trim())) {
    const single = /^(\d+)$/.exec(piece);
    const range = /^(\d+)-(\d+)$/.exec(piece);
    if (single) {
      const id = Number(single[1]);
      if (id < 1) throw new UsageError(`Metin kimliği 1 ya da daha büyük olmalı: "${piece}"`);
      ids.push(id);
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to < from || to - from + 1 > MAX_RANGE) {
        throw new UsageError(`Geçersiz aralık: "${piece}" (en çok ${MAX_RANGE} metin)`);
      }
      for (let id = from; id <= to; id++) ids.push(id);
    } else {
      throw new UsageError(`Geçersiz metin seçimi: "${piece}" (hepsi, 5, 3,5,9 ya da 1-27)`);
    }
  }
  return { ids: [...new Set(ids)] };
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`;
  return `${Math.floor(seconds / 3600)} sa ${Math.floor((seconds % 3600) / 60)} dk`;
}

const parseNames = (text: string): string[] => {
  const names = text.split(',').map((n) => n.trim());
  if (names.some((n) => n === '')) throw new UsageError(`Boş model adı var: "${text}"`);
  return names;
};

function parseInteger(text: string, flag: string, min: number, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`${flag} ${min} ile ${max} arasında bir tam sayı olmalı: "${text}"`);
  }
  return value;
}

function parsePositive(text: string, flag: string): number {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`${flag} sıfırdan büyük bir sayı olmalı: "${text}"`);
  }
  return value;
}

export interface BatchCliDeps {
  jobs: JobRepository;
  templates: PromptTemplateService;
  rubrics: RubricService;
  models: ProviderModelRepository;
  generations: GenerationRepository;
  evaluations: EvaluationRepository;
  providers: ProviderRegistry;
  /** Yeniden deneme ayarları (testlerde bekleme atlanır). */
  resilience?: ResilienceOptions;
  /** İş yokken yoklama aralığı (ms). */
  pollMs?: number;
  /** İlerleme satırı aralığı (ms), varsayılan 5000. */
  progressMs?: number;
}

/** Kaba giriş tokeni tahmini karakter/4'tür; Türkçede sağlayıcılar daha çok tokene böler (hakem smoke: Claude yaklaşık 2 kat), güvenlik payı. */
const INPUT_TOKEN_FACTOR = 2.5;
const DEFAULT_MAX_TOKENS = 4096;

interface ModelPlan {
  model: ProviderModelRecord;
  items: number;
  /** En kötü durum toplamı (dolar): bu modelin tüm öğeleri, çıktı maxTokens kadar olsaydı. Fiyat yoksa boş. */
  worstUsd: number | null;
  /** Geçmiş başarılı çağrıların ortalaması; geçmiş yoksa boş. */
  history?: { avgLatencyMs: number; avgCostUsd: number | null };
}

/** Planı satırlara döker. Şeritler (sağlayıcılar) paralel çalışır: toplam süreyi en yavaş şerit belirler. */
function planLines(plans: ModelPlan[], maxCostUsd?: number): string[] {
  const lanes = new Map<string, ModelPlan[]>();
  for (const plan of plans) {
    lanes.set(plan.model.provider, [...(lanes.get(plan.model.provider) ?? []), plan]);
  }

  const lines: string[] = [];
  const laneDurations: (number | null)[] = [];
  for (const [provider, lane] of lanes) {
    const items = lane.reduce((sum, p) => sum + p.items, 0);
    const names = lane.map((p) => `${p.model.modelId}: ${p.items}`).join(', ');
    const known = lane.every((p) => p.history !== undefined);
    const duration = known
      ? lane.reduce((sum, p) => sum + p.items * p.history!.avgLatencyMs, 0)
      : null;
    laneDurations.push(duration);
    let detail = 'geçmiş yok';
    if (known) {
      const avgLatency = duration! / Math.max(items, 1);
      const costs = lane.map((p) => p.history!.avgCostUsd);
      const avgCost = costs.every((c) => c !== null)
        ? lane.reduce((sum, p) => sum + p.items * p.history!.avgCostUsd!, 0) / Math.max(items, 1)
        : null;
      detail =
        `geçmiş: ortalama ${(avgLatency / 1000).toFixed(1)} sn/öğe` +
        (avgCost === null ? '' : `, ≈ $${avgCost.toFixed(4)}/öğe`) +
        ` → ≈ ${formatDuration(duration!)}`;
    }
    lines.push(`  Şerit ${provider}: ${items} öğe (${names}); ${detail}`);
  }

  const longest = laneDurations.every((d) => d !== null)
    ? Math.max(...(laneDurations as number[]))
    : null;
  const expected = plans.every(
    (p) => p.history?.avgCostUsd !== undefined && p.history.avgCostUsd !== null,
  )
    ? plans.reduce((sum, p) => sum + p.items * p.history!.avgCostUsd!, 0)
    : null;
  const worst = plans.every((p) => p.worstUsd !== null)
    ? plans.reduce((sum, p) => sum + p.worstUsd!, 0)
    : null;

  lines.push(
    `  Tahmini toplam süre: ${longest === null ? 'bilinmiyor (geçmiş veri yok)' : `${formatDuration(longest)} (şeritler paralel, en yavaş şerit belirler)`}`,
    `  Beklenen maliyet: ${expected === null ? 'bilinmiyor (geçmiş veri yok ya da fiyat bilgisi eksik)' : `$${expected.toFixed(4)} (geçmiş ortalamalardan)`}`,
    `  En kötü durum üst sınırı: ${worst === null ? 'bilinmiyor (fiyat bilgisi olmayan model var)' : `$${worst.toFixed(4)} (her çağrının çıktısı maxTokens kadar olsaydı; gerçekte çok daha düşük olur)`}`,
  );
  if (maxCostUsd !== undefined) {
    lines.push(`  Bütçe sınırı: $${maxCostUsd} (çalışırken uygulanır, dolunca iş durur)`);
  }
  return lines;
}

async function resolveModels(
  repo: ProviderModelRepository,
  names: string[],
): Promise<ProviderModelRecord[]> {
  const found = await repo.findByModelIds(names);
  return names.map((name) => {
    const matches = found.filter((m) => m.modelId === name);
    if (matches.length === 0) {
      throw new UsageError(`Model bulunamadı: ${name} (model listesi yüklü mü? npm run db:seed)`);
    }
    if (matches.length > 1) {
      throw new UsageError(`Model adı belirsiz (birden çok sağlayıcıda var): ${name}`);
    }
    return matches[0]!;
  });
}

/** Anahtarı olmayan sağlayıcıyı planda uyarır: bu hâliyle çalıştırılırsa iş çağrı yapılmadan başarısız olur. */
function providerWarnings(providers: ProviderRegistry, models: ProviderModelRecord[]): string[] {
  const warnings: string[] = [];
  for (const provider of new Set(models.map((m) => m.provider))) {
    try {
      providers.get(provider);
    } catch (error) {
      warnings.push(`  ⚠ ${error instanceof Error ? error.message : `${provider} kullanılamıyor`}`);
    }
  }
  return warnings;
}

const unfinishedJobs = async (jobs: JobRepository): Promise<StoredJob[]> =>
  (await jobs.list(100)).filter((j) => j.status === 'pending' || j.status === 'running');

function summarize(job: StoredJob, log: (line: string) => void): number {
  if (job.status === 'succeeded') {
    const spent = (job.result as { spentUsd?: number } | null)?.spentUsd;
    log(
      `İş #${job.id} bitti: ${job.done}/${job.total} tamam, ${job.failed} başarısız` +
        (typeof spent === 'number' ? `, harcanan ≈ $${spent.toFixed(4)}` : ''),
    );
    return job.failed > 0 ? 1 : 0;
  }
  if (job.status === 'failed') {
    log(`İş #${job.id} durdu: ${job.error ?? 'neden kaydedilmedi'}`);
    return 1;
  }
  log(
    `İş #${job.id} durduruldu (${job.done}/${job.total} tamam); kaldığı yerden sürdürmek için: npm run batch -- devam`,
  );
  return 0;
}

/** Kuyruktaki işleri işçiyle çalıştırır, ilerleme satırlarını yazar; verilen işlerin özetini döner (çıkış kodu). */
async function runJobs(
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal: AbortSignal | undefined,
  jobIds: number[],
  recover: boolean,
): Promise<number> {
  const resilience = deps.resilience ? { resilience: deps.resilience } : {};
  const generation = createGenerationService({
    models: deps.models,
    generations: deps.generations,
    templates: deps.templates,
    providers: deps.providers,
    ...resilience,
  });
  const evaluation = createEvaluationService({
    evaluations: deps.evaluations,
    models: deps.models,
    templates: deps.templates,
    rubrics: deps.rubrics,
    providers: deps.providers,
    ...resilience,
  });
  const runner = createJobRunner({
    jobs: deps.jobs,
    handlers: {
      [GENERATE_BATCH]: createGenerateBatchHandler({
        generation,
        generations: deps.generations,
        models: deps.models,
        templates: deps.templates,
        providers: deps.providers,
      }),
      [EVALUATE_BATCH]: createEvaluateBatchHandler({
        evaluation,
        evaluations: deps.evaluations,
        models: deps.models,
        templates: deps.templates,
        rubrics: deps.rubrics,
        providers: deps.providers,
      }),
    },
    pollMs: deps.pollMs ?? 1000,
  });

  if (recover) {
    const recovered = await runner.recover();
    if (recovered > 0) log(`Açılışta yarım kalan ${recovered} iş geri alındı.`);
  }
  const onAbort = () => void runner.stop();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  let last = '';
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void deps.jobs
      .list(5)
      .then((recent) => {
        const running = recent.find((j) => j.status === 'running');
        if (!running) return;
        const line = `[iş #${running.id}] ${running.done}/${running.total} tamam, ${running.failed} başarısız`;
        if (line !== last) {
          last = line;
          log(line);
        }
      })
      .finally(() => {
        busy = false;
      });
  }, deps.progressMs ?? 5000);

  try {
    await runner.runUntilIdle();
  } finally {
    clearInterval(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  let code = 0;
  for (const id of jobIds) {
    const job = await deps.jobs.findById(id);
    if (job) code = Math.max(code, summarize(job, log));
  }
  return code;
}

function checkFlags(parsed: ParsedArgs): void {
  for (const name of Object.keys(parsed.options)) {
    if (!COMMAND_FLAGS[parsed.command].includes(name)) {
      throw new UsageError(`${parsed.command} komutunda --${name} kullanılmaz`);
    }
  }
}

const option = (parsed: ParsedArgs, name: string): string | undefined => {
  const value = parsed.options[name];
  return typeof value === 'string' ? value : undefined;
};
const required = (parsed: ParsedArgs, name: string): string => {
  const value = option(parsed, name);
  if (value === undefined) throw new UsageError(`--${name} gerekli`);
  return value;
};

async function commandUret(
  parsed: ParsedArgs,
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal: AbortSignal | undefined,
): Promise<number> {
  const topics = parseTopics(required(parsed, 'konular'));
  const models = await resolveModels(deps.models, parseNames(required(parsed, 'modeller')));
  const tekrar = option(parsed, 'tekrar');
  const replicates = tekrar === undefined ? 1 : parseInteger(tekrar, '--tekrar', 1, 10);
  const butce = option(parsed, 'butce');
  const maxCostUsd = butce === undefined ? undefined : parsePositive(butce, '--butce');

  const prepared = await prepareGenerateBatch(deps.templates, {
    topics,
    modelIds: models.map((m) => m.id),
    replicates,
    ...(maxCostUsd !== undefined && { maxCostUsd }),
  });

  const usage = new Map(
    (await deps.generations.usageByModel(models.map((m) => m.id))).map((u) => [
      u.providerModelId,
      u,
    ]),
  );
  const plans: ModelPlan[] = models.map((model) => {
    const price = model.params.priceUsdPerMillion;
    const maxTokens = model.params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const perReplicate = prepared.topics.map((t) =>
      estimateCostUsd(
        estimateTokens(renderPrompt(prepared.template.body, generationVars(t.genre, t.theme))),
        maxTokens,
        price,
      ),
    );
    const history = usage.get(model.id);
    return {
      model,
      items: prepared.topics.length * replicates,
      worstUsd: perReplicate.some((c) => c === undefined)
        ? null
        : perReplicate.reduce<number>((sum, c) => sum + c!, 0) * replicates,
      ...(history && {
        history: {
          avgLatencyMs: history.avgLatencyMs,
          avgCostUsd:
            estimateCostUsd(history.avgInputTokens, history.avgOutputTokens, price) ?? null,
        },
      }),
    };
  });

  log('Plan: toplu üretim (generate_batch), gerçek çağrı yapılmadı');
  log(
    `  Konu: ${topics.length} (${topics.map((t) => `${t.genre}:${t.theme}`).join(', ')}) · Model: ${models.length} (${models.map((m) => m.modelId).join(', ')}) · Tekrar: ${replicates}`,
  );
  log(`  Toplam öğe: ${prepared.total}`);
  log(`  Komut şablonu: ${prepared.template.version} (işe sabitlenecek)`);
  for (const line of planLines(plans, maxCostUsd)) log(line);
  const warnings = providerWarnings(deps.providers, models);
  for (const line of warnings) log(line);

  if (parsed.options.calistir !== true) {
    log('Gerçekten başlatmak için komutun sonuna --calistir ekleyin.');
    return 0;
  }
  return startJob(deps, log, signal, GENERATE_BATCH, prepared.payload, prepared.total);
}

async function commandPuanla(
  parsed: ParsedArgs,
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal: AbortSignal | undefined,
): Promise<number> {
  const selection = parseIdSelection(required(parsed, 'metinler'));
  const tur = option(parsed, 'tur');
  if (tur !== undefined) {
    if (!('all' in selection))
      throw new UsageError('--tur yalnızca --metinler hepsi ile kullanılır');
    if (!(GENRES as readonly string[]).includes(tur))
      throw new UsageError(`Bilinmeyen tür: ${tur}`);
  }
  const textIds =
    'all' in selection
      ? await deps.evaluations.listTextIds(tur as Genre | undefined)
      : selection.ids;
  if (textIds.length === 0) throw new UsageError('Puanlanacak metin yok (önce metin üretin).');
  const judges = await resolveModels(deps.models, parseNames(required(parsed, 'hakemler')));
  const tekrar = option(parsed, 'tekrar');
  const replicates = tekrar === undefined ? 1 : parseInteger(tekrar, '--tekrar', 1, 10);
  const butce = option(parsed, 'butce');
  const maxCostUsd = butce === undefined ? undefined : parsePositive(butce, '--butce');
  const excludeSelf = parsed.options['kendini-disla'] === true;

  const prepared = await prepareEvaluateBatch(deps, {
    textIds,
    judgeModelIds: judges.map((m) => m.id),
    replicates,
    excludeSelf,
    ...(maxCostUsd !== undefined && { maxCostUsd }),
  });

  const refOf = (m: ProviderModelRecord) => `${m.provider}/${m.modelId}`;
  const usage = await deps.evaluations.recentUsage(judges.map(refOf), 50);
  const rubricFor = new Map(prepared.rubrics.map((r) => [r.genre, r]));
  const plans: ModelPlan[] = prepared.judges.map((judge) => {
    const price = judge.params.priceUsdPerMillion;
    const maxTokens = judge.params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const judgeTexts = prepared.textsPerJudge.get(judge.id) ?? [];
    const perText = judgeTexts.map((text) =>
      estimateCostUsd(
        Math.ceil(
          estimateTokens(
            renderPrompt(
              prepared.template.body,
              judgeVars({
                genre: text.genre,
                theme: text.theme,
                text: text.body,
                rubric: rubricFor.get(text.genre)!,
              }),
            ),
          ) * INPUT_TOKEN_FACTOR,
        ),
        maxTokens,
        price,
      ),
    );
    const samples = usage.filter((u) => u.evaluatorRef === refOf(judge));
    const avg = (pick: (u: (typeof samples)[number]) => number) =>
      samples.reduce((sum, u) => sum + pick(u), 0) / samples.length;
    return {
      model: judge,
      items: judgeTexts.length * replicates,
      worstUsd: perText.some((c) => c === undefined)
        ? null
        : perText.reduce<number>((sum, c) => sum + c!, 0) * replicates,
      ...(samples.length > 0 && {
        history: {
          avgLatencyMs: avg((u) => u.latencyMs),
          avgCostUsd:
            estimateCostUsd(
              avg((u) => u.inputTokens),
              avg((u) => u.outputTokens),
              price,
            ) ?? null,
        },
      }),
    };
  });

  log('Plan: toplu puanlama (evaluate_batch), gerçek çağrı yapılmadı');
  log(
    `  Metin: ${prepared.texts.length} · Hakem: ${judges.length} (${judges.map((m) => m.modelId).join(', ')}) · Tekrar: ${replicates}`,
  );
  log(`  Toplam öğe: ${prepared.total}`);
  log(`  Hakem komut şablonu: ${prepared.template.version} (işe sabitlenecek)`);
  log(
    `  Rubrik: ${prepared.rubrics.map((r) => `${r.genre} ${r.version}`).join(', ')} (işe sabitlenecek)`,
  );
  log(
    excludeSelf
      ? '  Kendini dışlama: bir hakem kendi ailesinin metnini puanlamaz (elle girilen metin dışlanmaz).'
      : '  Kendini dışlama yok: tüm hakemler her metni puanlar; kendi-puanı analizde yazar ve hakem ailesinden işaretlenir.',
  );
  for (const line of planLines(plans, maxCostUsd)) log(line);
  for (const line of providerWarnings(deps.providers, judges)) log(line);

  if (parsed.options.calistir !== true) {
    log('Gerçekten başlatmak için komutun sonuna --calistir ekleyin.');
    return 0;
  }
  return startJob(deps, log, signal, EVALUATE_BATCH, prepared.payload, prepared.total);
}

/** Yeni iş ekler ve çalıştırır. Kuyrukta bitmemiş iş varsa eklemez: tek işçi, önce onlar sürdürülmeli. */
async function startJob(
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal: AbortSignal | undefined,
  type: string,
  payload: Record<string, unknown>,
  total: number,
): Promise<number> {
  const pending = await unfinishedJobs(deps.jobs);
  if (pending.length > 0) {
    throw new UsageError(
      `Kuyrukta bitmemiş iş var (${pending.map((j) => `#${j.id}`).join(', ')}). Önce sürdürün: npm run batch -- devam`,
    );
  }
  const job = await deps.jobs.enqueue({ type, payload, total });
  log(
    `İş #${job.id} eklendi (${total} öğe), çalıştırılıyor. Durdurmak için Ctrl+C (kaldığı yerden devam edilebilir).`,
  );
  return runJobs(deps, log, signal, [job.id], false);
}

async function commandDevam(
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal: AbortSignal | undefined,
): Promise<number> {
  const recovered = await deps.jobs.requeueInterrupted();
  if (recovered > 0) log(`Açılışta yarım kalan ${recovered} iş geri alındı.`);
  const pending = (await deps.jobs.list(100)).filter((j) => j.status === 'pending');
  if (pending.length === 0) {
    log('Bekleyen iş yok.');
    return 0;
  }
  log(
    `${pending.length} bekleyen iş çalıştırılıyor (${pending.map((j) => `#${j.id}`).join(', ')}).`,
  );
  return runJobs(deps, log, signal, pending.map((j) => j.id).reverse(), false);
}

async function commandDurum(deps: BatchCliDeps, log: (line: string) => void): Promise<number> {
  const recent = await deps.jobs.list(20);
  if (recent.length === 0) {
    log('Hiç iş yok.');
    return 0;
  }
  for (const job of recent) {
    log(
      `#${job.id} ${job.type} ${job.status} ${job.done}/${job.total} (başarısız ${job.failed}) · ${job.createdAt.toISOString()}`,
    );
    if (job.status === 'failed' && job.error) log(`    neden: ${job.error}`);
  }
  return 0;
}

/**
 * Toplu üretim ve puanlama komut satırı. Varsayılan olarak yalnızca PLAN gösterir (çağrı ve harcama yok);
 * `--calistir` ile işi ekler ve çalıştırır. Çıkış kodu: 0 başarılı (ya da düzgün durdu), 1 iş durdu ya da
 * bazı öğeler başarısız, 2 hatalı kullanım.
 */
export async function runBatchCli(
  argv: string[],
  deps: BatchCliDeps,
  log: (line: string) => void,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const parsed = parseBatchArgs(argv);
    checkFlags(parsed);
    switch (parsed.command) {
      case 'uret':
        return await commandUret(parsed, deps, log, signal);
      case 'puanla':
        return await commandPuanla(parsed, deps, log, signal);
      case 'devam':
        return await commandDevam(deps, log, signal);
      case 'durum':
        return await commandDurum(deps, log);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      log(error.message);
      log(USAGE);
      return 2;
    }
    if (error instanceof ZodError) {
      log(
        `Geçersiz değer: ${error.issues.map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`).join('; ')}`,
      );
      return 2;
    }
    if (error instanceof AppError && error.status < 500) {
      log(error.message);
      return 2;
    }
    throw error;
  }
}
