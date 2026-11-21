import type { PromptKind, PromptTemplateInput } from '../domain/prompt.js';

/** Depolanmış şablon. Bir kez kaydedilen şablon değişmez: değişiklik yeni sürümdür (güncelleme yöntemi yoktur). */
export interface StoredPromptTemplate {
  id: number;
  kind: PromptKind;
  version: string;
  body: string;
  createdAt: Date;
}

/** Aynı tür ve sürümde başka bir şablon zaten var. */
export class DuplicatePromptTemplateError extends Error {
  constructor(
    public readonly kind: PromptKind,
    public readonly version: string,
  ) {
    super(`Şablon zaten var: ${kind} ${version}`);
    this.name = 'DuplicatePromptTemplateError';
  }
}

export interface PromptTemplateRepository {
  /** Aynı tür+sürüm varsa `DuplicatePromptTemplateError` fırlatır. */
  create(input: PromptTemplateInput): Promise<StoredPromptTemplate>;
  findById(id: number): Promise<StoredPromptTemplate | null>;
  /** Türün en son kaydedilen şablonu, yoksa null. */
  findLatest(kind: PromptKind): Promise<StoredPromptTemplate | null>;
}
