import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type {
  EvaluableText,
  EvaluationRepository,
  EvaluationSuccess,
  StartEvaluation,
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
