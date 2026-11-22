import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type { EnqueueJob, JobProgress, JobRepository, StoredJob } from './job.repository.js';

const MAX_TYPE_LENGTH = 32; // jobs.type VARCHAR(32)
const MAX_ERROR_LENGTH = 2000;

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

type JobRow = Awaited<ReturnType<Db['job']['findUniqueOrThrow']>>;

const toStored = (row: JobRow): StoredJob => ({
  id: row.id,
  type: row.type,
  payload: row.payload,
  status: row.status,
  total: row.total,
  done: row.done,
  failed: row.failed,
  result: row.result,
  error: row.error,
  attempts: row.attempts,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

/** MySQL (Prisma) iş kuyruğu. Sahiplenme, durumu "bekliyor"dan "çalışıyor"a geçiren tek bir koşullu güncellemedir. */
export class PrismaJobRepository implements JobRepository {
  constructor(private readonly db: Db) {}

  async enqueue(input: EnqueueJob): Promise<StoredJob> {
    if (input.type.length < 1 || input.type.length > MAX_TYPE_LENGTH) {
      throw new RangeError(`İş türü 1-${MAX_TYPE_LENGTH} karakter olmalı`);
    }
    if (!isCount(input.total))
      throw new RangeError('Toplam öğe sayısı negatif olmayan tam sayı olmalı');
    const row = await this.db.job.create({
      data: {
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        total: input.total,
      },
    });
    return toStored(row);
  }

  async findById(id: number): Promise<StoredJob | null> {
    const row = await this.db.job.findUnique({ where: { id } });
    return row ? toStored(row) : null;
  }

  async claimNext(types?: string[]): Promise<StoredJob | null> {
    if (types && types.length === 0) return null;
    for (;;) {
      const candidate = await this.db.job.findFirst({
        where: { status: 'pending', ...(types && { type: { in: types } }) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!candidate) return null;
      // Koşullu güncelleme: aynı anda başka işçi kaptıysa sayı 0 döner, sıradaki aday denenir.
      const won = await this.db.job.updateMany({
        where: { id: candidate.id, status: 'pending' },
        data: {
          status: 'running',
          attempts: { increment: 1 },
          startedAt: candidate.startedAt ?? new Date(),
        },
      });
      if (won.count === 1) {
        return toStored(await this.db.job.findUniqueOrThrow({ where: { id: candidate.id } }));
      }
    }
  }

  async setProgress(id: number, progress: JobProgress): Promise<void> {
    if (!isCount(progress.done) || !isCount(progress.failed)) {
      throw new RangeError('İlerleme sayaçları negatif olmayan tam sayı olmalı');
    }
    await this.db.job.update({
      where: { id },
      data: { done: progress.done, failed: progress.failed },
    });
  }

  async complete(id: number, result: unknown): Promise<void> {
    await this.db.job.update({
      where: { id },
      data: {
        status: 'succeeded',
        result: result as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  }

  async fail(id: number, error: string): Promise<void> {
    await this.db.job.update({
      where: { id },
      data: { status: 'failed', error: error.slice(0, MAX_ERROR_LENGTH), finishedAt: new Date() },
    });
  }

  async release(id: number): Promise<void> {
    await this.db.job.updateMany({
      where: { id, status: 'running' },
      data: { status: 'pending' },
    });
  }

  async requeueInterrupted(): Promise<number> {
    const result = await this.db.job.updateMany({
      where: { status: 'running' },
      data: { status: 'pending' },
    });
    return result.count;
  }
}
