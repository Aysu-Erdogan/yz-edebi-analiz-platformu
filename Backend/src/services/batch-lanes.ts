import type { JobContext, JobResult } from './job-runner.js';

/** Toplu işin tek öğesi (bir üretim ya da bir puanlama). */
export interface BatchItem {
  /** Öğenin kimliği: biten öğeleri tanımak için (yeniden başlatmada atlanır). */
  key: string;
  /** Şerit: genelde sağlayıcı. Aynı şeritteki öğeler sırayla, farklı şeritler paralel çalışır. */
  lane: string;
  /** Öğeyi çalıştırır; sağlayıcı hatası burada fırlatılmaz, `succeeded: false` döner (T09). */
  run(): Promise<{ succeeded: boolean; costUsd: number | null }>;
}

/**
 * Toplu işlerin ortak çalıştırıcısı (üretim ve puanlama): şeritler paralel, her şerit sırayla; biten öğeler atlanır;
 * her öğeden sonra sayaçlar yazılır; harcama `maxCostUsd`'e ulaşınca yeni öğe alınmaz; kapatma istenince çalışan
 * öğe biter, iş bekleyene döner.
 */
export async function runBatchLanes(
  ctx: JobContext,
  items: BatchItem[],
  finished: ReadonlySet<string>,
  maxCostUsd?: number,
): Promise<JobResult> {
  const lanes = new Map<string, BatchItem[]>();
  for (const item of items) {
    const lane = lanes.get(item.lane) ?? [];
    lane.push(item);
    lanes.set(item.lane, lane);
  }

  let done = items.filter((item) => finished.has(item.key)).length;
  let failed = 0;
  let spent = 0; // shortcut: bütçe her çalıştırma için ayrı sayılır (çökme sonrası devamda sıfırdan)
  let halt: 'budget' | 'error' | undefined;

  // Şeritler aynı anda yazar: yazmaları sıraya dizip her seferinde güncel sayaçları yazarız.
  let writes: Promise<void> = Promise.resolve();
  const report = () => (writes = writes.then(() => ctx.progress({ done, failed })));
  await report(); // yeniden başlatmada devam noktası hemen görünsün

  async function runLane(laneItems: BatchItem[]): Promise<void> {
    try {
      for (const item of laneItems) {
        if (finished.has(item.key)) continue;
        if (ctx.signal.aborted || halt) return;
        const outcome = await item.run();
        if (outcome.succeeded) done++;
        else failed++;
        spent += outcome.costUsd ?? 0;
        if (maxCostUsd !== undefined && spent >= maxCostUsd) halt ??= 'budget';
        await report();
      }
    } catch (error) {
      halt = 'error'; // diğer şeritler yeni öğe almasın
      throw error;
    }
  }

  const settled = await Promise.allSettled([...lanes.values()].map(runLane));
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (rejected) throw rejected.reason; // kod/veritabanı hatası: iş failed olur, neden yazılır
  if (ctx.signal.aborted) return { status: 'interrupted' };
  if (halt === 'budget') {
    return {
      status: 'failed',
      error: `Bütçe doldu: harcanan $${spent.toFixed(4)} (sınır $${maxCostUsd}); ${done}/${ctx.job.total} öğe tamam. Aynı parametrelerle yeni iş eklerseniz kalanlar yapılır, biten öğeler atlanır.`,
    };
  }
  return { status: 'done', result: { done, failed, spentUsd: spent } };
}
