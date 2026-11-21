import type { Genre, RubricInput } from '../../src/domain/rubric.js';
import {
  DuplicateRubricError,
  type RubricFilter,
  type RubricRepository,
  type StoredRubric,
} from '../../src/repositories/rubric.repository.js';

/** Dışarıdan değiştirilirse depodaki veri bozulmasın diye her zaman kopya verilir. */
const copy = <T>(value: T): T => structuredClone(value);

/**
 * Servis testleri için bellek içi rubrik deposu. Gerçek depoyla aynı sözleşmeye uyar
 * (`tests/contracts/rubric-repository.contract.ts`).
 */
export class InMemoryRubricRepository implements RubricRepository {
  private rows: StoredRubric[] = [];
  private nextId = 1;

  async create(input: RubricInput): Promise<StoredRubric> {
    this.assertUnique(input.genre, input.version);
    const row: StoredRubric = {
      ...copy(input),
      id: this.nextId++,
      status: 'draft',
      usedAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return copy(row);
  }

  async findById(id: number): Promise<StoredRubric | null> {
    return this.cloneOrNull(this.rows.find((r) => r.id === id));
  }

  async findByGenreVersion(genre: Genre, version: string): Promise<StoredRubric | null> {
    return this.cloneOrNull(this.rows.find((r) => r.genre === genre && r.version === version));
  }

  async list(filter: RubricFilter = {}): Promise<StoredRubric[]> {
    return this.rows
      .filter((r) => (filter.genre ? r.genre === filter.genre : true))
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .map(copy);
  }

  async findActive(genre: Genre): Promise<StoredRubric | null> {
    return this.cloneOrNull(this.rows.find((r) => r.genre === genre && r.status === 'active'));
  }

  async replace(id: number, input: RubricInput): Promise<StoredRubric | null> {
    const index = this.rows.findIndex((r) => r.id === id);
    const current = this.rows[index];
    if (!current) return null;
    this.assertUnique(input.genre, input.version, id);
    const next: StoredRubric = {
      ...copy(input),
      id,
      status: current.status,
      usedAt: current.usedAt,
      createdAt: current.createdAt,
    };
    this.rows[index] = next;
    return copy(next);
  }

  async activate(id: number): Promise<StoredRubric | null> {
    const target = this.rows.find((r) => r.id === id);
    if (!target) return null;
    for (const row of this.rows) {
      if (row.genre === target.genre && row.status === 'active' && row.id !== id) {
        row.status = 'archived';
      }
    }
    target.status = 'active';
    return copy(target);
  }

  async markUsed(id: number, at: Date): Promise<StoredRubric | null> {
    const target = this.rows.find((r) => r.id === id);
    if (!target) return null;
    target.usedAt ??= new Date(at);
    return copy(target);
  }

  private assertUnique(genre: Genre, version: string, exceptId?: number): void {
    const clash = this.rows.some(
      (r) => r.genre === genre && r.version === version && r.id !== exceptId,
    );
    if (clash) throw new DuplicateRubricError(genre, version);
  }

  private cloneOrNull(row: StoredRubric | undefined): StoredRubric | null {
    return row ? copy(row) : null;
  }
}
