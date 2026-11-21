import type { Genre, RubricInput, RubricStatus } from '../domain/rubric.js';

/** Depolanmış rubrik: girdi biçimi + sistemin tuttuğu alanlar. */
export type StoredRubric = RubricInput & {
  id: number;
  status: RubricStatus;
  /** İlk kez bir değerlendirmede kullanıldığı an. Dolunca rubrik değiştirilemez (ADR 0003). */
  usedAt: Date | null;
  createdAt: Date;
};

export interface RubricFilter {
  genre?: Genre;
  status?: RubricStatus;
}

/** Aynı tür ve sürümde başka bir rubrik zaten var (benzersizlik kuralı ihlali). */
export class DuplicateRubricError extends Error {
  constructor(
    public readonly genre: Genre,
    public readonly version: string,
  ) {
    super(`Rubrik zaten var: ${genre} ${version}`);
    this.name = 'DuplicateRubricError';
  }
}

/**
 * Rubrik verisine erişim sözleşmesi. Servis yalnızca bu arayüzü bilir; gerçek (MySQL) ve
 * bellek içi sürümler `tests/contracts/rubric-repository.contract.ts` ile aynı kurallara uyar.
 * İş kuralları (kullanılmış rubrik değişmez gibi) burada değil, serviste.
 */
export interface RubricRepository {
  /** Taslak olarak kaydeder. Aynı tür+sürüm varsa `DuplicateRubricError` fırlatır. */
  create(input: RubricInput): Promise<StoredRubric>;

  findById(id: number): Promise<StoredRubric | null>;

  findByGenreVersion(genre: Genre, version: string): Promise<StoredRubric | null>;

  /** Kimliğe (id) göre artan sırada döner. */
  list(filter?: RubricFilter): Promise<StoredRubric[]>;

  /** Türün etkin rubriği, yoksa null. */
  findActive(genre: Genre): Promise<StoredRubric | null>;

  /**
   * Rubriğin içeriğini tümüyle değiştirir (durum ve kullanım bilgisi korunur).
   * Yoksa null; yeni tür+sürüm başka bir rubriğe aitse `DuplicateRubricError`.
   */
  replace(id: number, input: RubricInput): Promise<StoredRubric | null>;

  /**
   * Tek adımda (atomik): aynı türdeki önceki etkin rubrik arşivlenir, bu rubrik etkin olur.
   * Rubrik yoksa null.
   */
  activate(id: number): Promise<StoredRubric | null>;

  /** İlk kullanım zamanını kaydeder; zaten doluysa ilk değeri korur. Rubrik yoksa null. */
  markUsed(id: number, at: Date): Promise<StoredRubric | null>;
}
