import { Prisma } from '../generated/prisma/client.js';
import type { PromptKind, PromptTemplateInput } from '../domain/prompt.js';
import type { Db } from '../lib/prisma.js';
import {
  DuplicatePromptTemplateError,
  type PromptTemplateRepository,
  type StoredPromptTemplate,
} from './prompt-template.repository.js';

/** MySQL (Prisma) şablon deposu. */
export class PrismaPromptTemplateRepository implements PromptTemplateRepository {
  constructor(private readonly db: Db) {}

  async create(input: PromptTemplateInput): Promise<StoredPromptTemplate> {
    try {
      return await this.db.promptTemplate.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicatePromptTemplateError(input.kind, input.version);
      }
      throw error;
    }
  }

  findById(id: number): Promise<StoredPromptTemplate | null> {
    return this.db.promptTemplate.findUnique({ where: { id } });
  }

  findLatest(kind: PromptKind): Promise<StoredPromptTemplate | null> {
    return this.db.promptTemplate.findFirst({ where: { kind }, orderBy: { id: 'desc' } });
  }
}
