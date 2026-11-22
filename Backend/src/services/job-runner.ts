import type { JobProgress, JobRepository, StoredJob } from '../repositories/job.repository.js';

export interface JobContext {
  /** Sahiplenme anındaki iş: `done`/`failed` yeniden başlatmada kaldığı yeri gösterir (biten öğeler atlanır). */
  job: StoredJob;
  /** Kapatma istenince iptal olur: yeni öğe başlatılmaz, çalışan öğe bitirilir, işleyici `interrupted` döner. */
  signal: AbortSignal;
  /** Biten ve başarısız öğe sayısını (mutlak) yazar; ilerleme çubuğu ve devam noktası buradan gelir. */
  progress(update: JobProgress): Promise<void>;
}

export type JobResult = { status: 'done'; result?: unknown } | { status: 'interrupted' };

/**
 * Bir iş türünün işleyicisi. Öğelerin hata yalıtımı işleyicinin görevidir (bir öğenin hatası işi durdurmaz,
 * `failed` sayacına yazılır); işleyici hata fırlatırsa **iş** `failed` olur.
 */
export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobRunner {
  /** Yarım kalan ("çalışıyor") işleri bekleyene geri alır; kaç tane olduğunu döner. */
  recover(): Promise<number>;
  /** Sıradaki bekleyen işi alıp çalıştırır; iş yoksa (ya da işçi kapandıysa) false döner. */
  runNext(): Promise<boolean>;
  /** İş kalmayana kadar sırayla çalıştırır (komut satırından toplu çalıştırma için). */
  runUntilIdle(): Promise<void>;
  /** Açılışta toparlar, sonra `stop` çağrılana kadar yeni işleri bekleyip çalıştırır. */
  start(): Promise<void>;
  /** Yeni iş almayı bırakır, çalışan öğeyi bitirir, işi bekleyene döndürür ve döngünün bitmesini bekler. */
  stop(): Promise<void>;
}

export interface JobRunnerOptions {
  jobs: JobRepository;
  /** İş türü → işleyici. İşleyicisi olmayan türdeki işler sahiplenilmez, bekleyen kalır. */
  handlers: Record<string, JobHandler>;
  /** İş yokken yoklama aralığı (ms). */
  pollMs?: number;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * DB tabanlı iş kuyruğunun işçisi. Tek işçi için tasarlandı (bkz. `JobRepository`): aynı anda iki işçi
 * çalıştırılmaz. Dışa açık uç (iş başlat, ilerlemeyi gör) F4'te yönetici girişiyle gelir.
 */
export function createJobRunner({ jobs, handlers, pollMs = 1000 }: JobRunnerOptions): JobRunner {
  const types = Object.keys(handlers);
  const stopping = new AbortController();
  let loop: Promise<void> | undefined;

  async function runNext(): Promise<boolean> {
    if (stopping.signal.aborted) return false;
    const job = await jobs.claimNext(types);
    if (!job) return false;
    try {
      const outcome = await handlers[job.type]!({
        job,
        signal: stopping.signal,
        progress: (update) => jobs.setProgress(job.id, update),
      });
      if (outcome.status === 'done') {
        await jobs.complete(job.id, outcome.result ?? null);
      } else if (stopping.signal.aborted) {
        await jobs.release(job.id); // düzgün kapanma: sonraki açılışta kaldığı yerden devam eder
      } else {
        // Kapatma istenmeden "yarım kaldım" diyen işleyici, işi sonsuz döngüye sokar: hata say.
        await jobs.fail(job.id, 'İşleyici kapatma istenmeden yarıda döndü');
      }
    } catch (error) {
      await jobs.fail(job.id, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  return {
    recover: () => jobs.requeueInterrupted(),
    runNext,
    async runUntilIdle() {
      while (await runNext());
    },
    start() {
      loop = (async () => {
        await jobs.requeueInterrupted();
        while (!stopping.signal.aborted) {
          if (!(await runNext())) await sleep(pollMs, stopping.signal);
        }
      })();
      return loop;
    },
    async stop() {
      stopping.abort();
      await loop;
    },
  };
}
