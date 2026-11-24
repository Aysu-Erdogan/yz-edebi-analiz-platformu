import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type {
  EvaluableText,
  EvaluationRepository,
  EvaluationUsage,
  EvaluationSuccess,
  StartEvaluation,
  SucceededEvaluation,
  TextAuthor,
} from './evaluation.repository.js';

const MAX_ERROR_LENGTH = 2000;

/** MySQL (Prisma) hakem puanı kayıt defteri. */
export class PrismaEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: Db) {}

  findText(id: number): Promise<EvaluableText | null> {
    return this.db.text.findUnique({
      where: { id },
      select: { id: true, genre: true, theme: true, body: true },
    });
  }

  findTexts(ids: number[]): Promise<EvaluableText[]> {
    return this.db.text.findMany({
      where: { id: { in: ids } },
      select: { id: true, genre: true, theme: true, body: true },
    });
  }

  async findAuthors(textIds: number[]): Promise<TextAuthor[]> {
    const rows = await this.db.text.findMany({
      where: { id: { in: textIds }, generationId: { not: null } },
      select: {
        id: true,
        generation: { select: { providerModel: { select: { provider: true, modelId: true } } } },
      },
    });
    return rows.flatMap((row) => {
      const model = row.generation?.providerModel;
      return model ? [{ textId: row.id, provider: model.provider, modelId: model.modelId }] : [];
    });
  }

  findSucceeded(filter: {
    promptTemplateId: number;
    rubricIds: number[];
    textIds: number[];
  }): Promise<SucceededEvaluation[]> {
    return this.db.evaluation.findMany({
      where: {
        status: 'succeeded',
        promptTemplateId: filter.promptTemplateId,
        rubricId: { in: filter.rubricIds },
        textId: { in: filter.textIds },
      },
      select: { textId: true, evaluatorRef: true, replicateNo: true },
    });
  }

  async listTextIds(genre?: EvaluableText['genre']): Promise<number[]> {
    const rows = await this.db.text.findMany({
      where: genre ? { genre } : {},
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  async recentUsage(evaluatorRefs: string[], perEvaluator: number): Promise<EvaluationUsage[]> {
    const usage: EvaluationUsage[] = [];
    for (const evaluatorRef of evaluatorRefs) {
      const rows = await this.db.evaluation.findMany({
        where: { status: 'succeeded', evaluatorRef },
        select: { rawResponse: true },
        orderBy: { id: 'desc' },
        take: perEvaluator,
      });
      for (const row of rows) {
        const u = (row.rawResponse as { usage?: Record<string, unknown> } | null)?.usage;
        if (
          typeof u?.inputTokens === 'number' &&
          typeof u.outputTokens === 'number' &&
          typeof u.latencyMs === 'number'
        ) {
          usage.push({
            evaluatorRef,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            latencyMs: u.latencyMs,
          });
        }
      }
    }
    return usage;
  }

  async failInterrupted(error: string): Promise<number> {
    const result = await this.db.evaluation.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', error: error.slice(0, MAX_ERROR_LENGTH) },
    });
    return result.count;
  }

  async start(input: StartEvaluation): Promise<number> {
    const row = await this.db.evaluation.create({
      data: {
        textId: input.textId,
        rubricId: input.rubricId,
        promptTemplateId: input.promptTemplateId,
        evaluatorType: 'llm', // insan puanı etik kurul onayına kadar kapalı
        evaluatorRef: input.evaluatorRef,
        replicateNo: input.replicateNo,
        status: 'running',
      },
      select: { id: true },
    });
    return row.id;
  }

  async succeed(id: number, result: EvaluationSuccess): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.evaluation.update({
        where: { id },
        data: {
          status: 'succeeded',
          totalScore: result.totalScore,
          rawResponse: result.rawResponse as Prisma.InputJsonObject,
        },
      });
      await tx.evaluationScore.createMany({
        data: result.scores.map((s) => ({
          evaluationId: id,
          criterionKey: s.key,
          score: s.score,
          comment: s.comment,
        })),
      });
    });
  }

  async fail(
    id: number,
    failure: { error: string; rawResponse?: Record<string, unknown> },
  ): Promise<void> {
    await this.db.evaluation.update({
      where: { id },
      data: {
        status: 'failed',
        error: failure.error.slice(0, MAX_ERROR_LENGTH),
        ...(failure.rawResponse && { rawResponse: failure.rawResponse as Prisma.InputJsonObject }),
      },
    });
  }
}
