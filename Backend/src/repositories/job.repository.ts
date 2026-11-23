export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/** Kuyruktaki bir iş: toplu üretim ya da toplu puanlama gibi uzun, öğelerden oluşan iş. */
export interface StoredJob {
  id: number;
  /** İşleyiciyi seçer (örn. `evaluate_batch`), en çok 32 karakter. */
  type: string;
  /** İşin parametreleri; yeniden başlatmada aynı öğe listesini kurabilmek için belirleyici olmalı. */
  payload: unknown;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  result: unknown;
  error: string | null;
  /** Kaç kez sahiplenildi (yeniden başlatmalar dahil). */
  attempts: number;
  createdAt: Date;
  /** İlk sahiplenme zamanı; yeniden başlatmada değişmez. */
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface EnqueueJob {
  type: string;
  payload: unknown;
  total: number;
}

export interface JobProgress {
  done: number;
  failed: number;
}

/**
 * İş kuyruğu kayıt defteri. Tek işçi için tasarlandı: aynı anda iki işçi aynı işi alamaz (sahiplenme tek adımdır),
 * ama yarım kalan işleri geri alma ("çalışıyor" → "bekliyor") yalnızca açılışta tek işçi olduğu varsayımıyla güvenlidir.
 */
export interface JobRepository {
  enqueue(input: EnqueueJob): Promise<StoredJob>;
  findById(id: number): Promise<StoredJob | null>;
  /** En son eklenen `limit` iş, en yenisi önce (durum ekranı için). */
  list(limit: number): Promise<StoredJob[]>;
  /**
   * Sıradaki (en eski) bekleyen işi tek adımda sahiplenir: çalışıyor olur, deneme sayısı artar.
   * `types` verilirse yalnızca o türler alınır; yoksa ya da bekleyen kalmadıysa null.
   */
  claimNext(types?: string[]): Promise<StoredJob | null>;
  /** Mutlak değerler yazar (biten ve başarısız öğe sayısı). */
  setProgress(id: number, progress: JobProgress): Promise<void>;
  complete(id: number, result: unknown): Promise<void>;
  fail(id: number, error: string): Promise<void>;
  /** Düzgün kapanma: çalışan işi bekleyene döndürür (sayaçlar korunur). Çalışmıyorsa dokunmaz. */
  release(id: number): Promise<void>;
  /** Açılışta: yarım kalan ("çalışıyor") işleri bekleyene geri alır, kaç tane olduğunu döner. */
  requeueInterrupted(): Promise<number>;
}
