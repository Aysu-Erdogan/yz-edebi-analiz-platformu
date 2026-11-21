import { Prisma } from '../generated/prisma/client.js';
import type { RubricInput } from '../domain/rubric.js';
import type { Db } from '../lib/prisma.js';
import {
  DuplicateRubricError,
  type RubricFilter,
  type RubricRepository,
  type StoredRubric,
} from './rubric.repository.js';

const include = { criteria: { include: { levels: true } } } as const;
type RubricRow = Prisma.RubricGetPayload<{ include: typeof include }>;

/** Kriterler sıra numarasına, düzeyler puana göre sıralanır (veritabanı sırayı garanti etmez). */
function toStored(row: RubricRow): StoredRubric {
  return {
    id: row.id,
    genre: row.genre,
    version: row.version,
    ...(row.sourceNote !== null && { sourceNote: row.sourceNote }),
    scale: { min: row.scaleMin, max: row.scaleMax },
    criteria: [...row.criteria]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description,
        weight: c.weight,
        levels: [...c.levels]
          .sort((a, b) => a.score - b.score)
          .map((l) => ({ score: l.score, descriptor: l.descriptor })),
      })),
    status: row.status,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

/** Kriter ve düzeyleri iç içe oluşturma verisi (sıra numarası dizideki konumdur). */
function nestedCriteria(input: RubricInput) {
  return {
    create: input.criteria.map((c, index) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      weight: c.weight,
      sortOrder: index,
      levels: { create: c.levels.map((l) => ({ score: l.score, descriptor: l.descriptor })) },
    })),
  };
}

function rubricFields(input: RubricInput) {
  return {
    genre: input.genre,
    version: input.version,
    sourceNote: input.sourceNote ?? null,
    scaleMin: input.scale.min,
    scaleMax: input.scale.max,
  };
}

/**
 * Benzersizlik ihlali (P2002) tür+sürüm çakışmasıdır; kriter anahtarı tekrarını şema (zod) zaten
 * engelliyor, bu yüzden buraya yalnızca rubrik çakışması ulaşır.
 */
function asDuplicate(error: unknown, input: RubricInput): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new DuplicateRubricError(input.genre, input.version);
  }
  return error;
}

/** MySQL (Prisma) rubrik deposu. Sözleşme: `tests/contracts/rubric-repository.contract.ts`. */
export class PrismaRubricRepository implements RubricRepository {
  constructor(private readonly db: Db) {}

  async create(input: RubricInput): Promise<StoredRubric> {
    try {
      const row = await this.db.rubric.create({
        data: { ...rubricFields(input), criteria: nestedCriteria(input) },
        include,
      });
      return toStored(row);
    } catch (error) {
      throw asDuplicate(error, input);
    }
  }

  async findById(id: number): Promise<StoredRubric | null> {
    const row = await this.db.rubric.findUnique({ where: { id }, include });
    return row ? toStored(row) : null;
  }

  async findByGenreVersion(
    genre: RubricInput['genre'],
    version: string,
  ): Promise<StoredRubric | null> {
    const row = await this.db.rubric.findUnique({
      where: { genre_version: { genre, version } },
      include,
    });
    return row ? toStored(row) : null;
  }

  async list(filter: RubricFilter = {}): Promise<StoredRubric[]> {
    const rows = await this.db.rubric.findMany({
      where: {
        ...(filter.genre !== undefined && { genre: filter.genre }),
        ...(filter.status !== undefined && { status: filter.status }),
      },
      orderBy: { id: 'asc' },
      include,
    });
    return rows.map(toStored);
  }

  async findActive(genre: RubricInput['genre']): Promise<StoredRubric | null> {
    const row = await this.db.rubric.findFirst({ where: { genre, status: 'active' }, include });
    return row ? toStored(row) : null;
  }

  /** Tek işlemde: eski kriterler silinir, yenileri yazılır. Çakışma olursa işlem geri alınır. */
  async replace(id: number, input: RubricInput): Promise<StoredRubric | null> {
    try {
      return await this.db.$transaction(async (tx) => {
        const existing = await tx.rubric.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return null;
        await tx.rubricCriterion.deleteMany({ where: { rubricId: id } }); // düzeyler zincirleme silinir
        const row = await tx.rubric.update({
          where: { id },
          data: { ...rubricFields(input), criteria: nestedCriteria(input) },
          include,
        });
        return toStored(row);
      });
    } catch (error) {
      throw asDuplicate(error, input);
    }
  }

  /** Tek işlemde: aynı türdeki önceki etkin rubrik arşivlenir, bu rubrik etkin olur. */
  async activate(id: number): Promise<StoredRubric | null> {
    return this.db.$transaction(async (tx) => {
      const target = await tx.rubric.findUnique({ where: { id }, select: { genre: true } });
      if (!target) return null;
      await tx.rubric.updateMany({
        where: { genre: target.genre, status: 'active', NOT: { id } },
        data: { status: 'archived' },
      });
      const row = await tx.rubric.update({ where: { id }, data: { status: 'active' }, include });
      return toStored(row);
    });
  }

  /** Yalnızca henüz boşsa yazar: eşzamanlı çağrılarda ilk zaman kazanır. */
  async markUsed(id: number, at: Date): Promise<StoredRubric | null> {
    const existing = await this.db.rubric.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;
    await this.db.rubric.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } });
    return this.findById(id);
  }
}
