import { promptTemplateInputSchema, type PromptKind } from '../domain/prompt.js';
import { AppError } from '../lib/errors.js';
import {
  DuplicatePromptTemplateError,
  type PromptTemplateRepository,
  type StoredPromptTemplate,
} from '../repositories/prompt-template.repository.js';

export interface PromptTemplateService {
  /** Doğrular ve kaydeder. Aynı tür+sürüm varsa 409: değişiklik yeni sürüm olarak yazılır. */
  createTemplate(raw: unknown): Promise<StoredPromptTemplate>;
  getTemplate(id: number): Promise<StoredPromptTemplate>;
  /** Türün en son sürümü; hiç yoksa 404. */
  getLatest(kind: PromptKind): Promise<StoredPromptTemplate>;
}

export function createPromptTemplateService(repo: PromptTemplateRepository): PromptTemplateService {
  return {
    async createTemplate(raw) {
      const input = promptTemplateInputSchema.parse(raw);
      try {
        return await repo.create(input);
      } catch (error) {
        if (error instanceof DuplicatePromptTemplateError) {
          throw AppError.conflict(
            `Bu sürüm zaten var: ${input.kind} ${input.version}. Değişiklik için yeni bir sürüm adı kullanın.`,
          );
        }
        throw error;
      }
    },

    async getTemplate(id) {
      const template = await repo.findById(id);
      if (!template) throw AppError.notFound(`Şablon bulunamadı: ${id}`);
      return template;
    },

    async getLatest(kind) {
      const template = await repo.findLatest(kind);
      if (!template) throw AppError.notFound(`${kind} türü için şablon yok`);
      return template;
    },
  };
}
