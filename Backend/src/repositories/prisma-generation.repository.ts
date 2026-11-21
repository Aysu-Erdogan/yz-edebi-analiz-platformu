import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type {
  GenerationRepository,
  GenerationSuccess,
  StartGeneration,
} from './generation.repository.js';

const MAX_ERROR_LENGTH = 2000;

/** MySQL (Prisma) üretim kayıt defteri. */
export class PrismaGenerationRepository implements GenerationRepository {
  constructor(private readonly db: Db) {}

  async start(input: StartGeneration): Promise<number> {
    const row = await this.db.generation.create({
      data: {
        providerModelId: input.providerModelId,
        promptTemplateId: input.promptTemplateId,
        genre: input.genre,
        theme: input.theme,
        replicateNo: input.replicateNo,
        params: input.params as Prisma.InputJsonObject,
        status: 'running',
      },
      select: { id: true },
    });
    return row.id;
  }

  succeed(id: number, result: GenerationSuccess): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await tx.generation.update({
        where: { id },
        data: {
          status: 'succeeded',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          completedAt: new Date(),
        },
      });
      const text = await tx.text.create({
        data: {
          genre: result.genre,
          theme: result.theme,
          body: result.body,
          source: 'generated',
          generationId: id,
        },
        select: { id: true },
      });
      return text.id;
    });
  }

  async fail(id: number, failure: { error: string; latencyMs: number }): Promise<void> {
    await this.db.generation.update({
      where: { id },
      data: {
        status: 'failed',
        error: failure.error.slice(0, MAX_ERROR_LENGTH),
        latencyMs: failure.latencyMs,
        completedAt: new Date(),
      },
    });
  }
}
