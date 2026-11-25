import type { Db } from '../lib/prisma.js';
import type { NewManualText, TextRepository } from './text.repository.js';

/** MySQL (Prisma) elle girilen metin kaydı. */
export class PrismaTextRepository implements TextRepository {
  constructor(private readonly db: Db) {}

  createManual(items: NewManualText[]): Promise<number[]> {
    return this.db.$transaction(async (tx) => {
      const ids: number[] = [];
      for (const item of items) {
        const row = await tx.text.create({
          data: { ...item, source: 'manual' },
          select: { id: true },
        });
        ids.push(row.id);
      }
      return ids;
    });
  }
}
