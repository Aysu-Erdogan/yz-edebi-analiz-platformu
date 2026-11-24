import type { ExportEvaluation } from '../domain/export.js';
import type { Db } from '../lib/prisma.js';
import type { ExportRepository } from './export.repository.js';

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** MySQL (Prisma) dışa aktarma sorgusu. */
export class PrismaExportRepository implements ExportRepository {
  constructor(private readonly db: Db) {}

  // shortcut: tüm kayıtlar tek sorguda belleğe okunur (27 metin × 3 hakem × tekrar, yüzlerce kayıt); binlerce
  // kayda çıkarsa sayfalama gerekir.
  async listEvaluations(): Promise<ExportEvaluation[]> {
    const rows = await this.db.evaluation.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        textId: true,
        evaluatorRef: true,
        replicateNo: true,
        status: true,
        error: true,
        totalScore: true,
        rawResponse: true,
        rubric: { select: { version: true, sourceNote: true } },
        promptTemplate: { select: { version: true } },
        text: {
          select: {
            genre: true,
            theme: true,
            body: true,
            label: true,
            generation: {
              select: {
                providerModel: { select: { provider: true, modelId: true } },
                promptTemplate: { select: { version: true } },
              },
            },
          },
        },
        scores: {
          select: { criterionKey: true, score: true, comment: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    return rows.map((row) => {
      // Başarılı kayıtta süre ve token `usage` içinde, başarısızda süre kökte durur (judge/evaluation servisi).
      const raw = row.rawResponse as {
        attempts?: unknown;
        latencyMs?: unknown;
        usage?: Record<string, unknown>;
      } | null;
      const model = row.text.generation?.providerModel;
      return {
        evaluationId: row.id,
        textId: row.textId,
        genre: row.text.genre,
        theme: row.text.theme,
        textBody: row.text.body,
        author: model ? { provider: model.provider, modelId: model.modelId } : null,
        label: row.text.label,
        judge: row.evaluatorRef,
        replicateNo: row.replicateNo,
        status: row.status,
        error: row.error,
        totalScore: row.totalScore,
        rubricVersion: row.rubric.version,
        rubricNote: row.rubric.sourceNote,
        judgeTemplateVersion: row.promptTemplate?.version ?? null,
        generationTemplateVersion: row.text.generation?.promptTemplate.version ?? null,
        attempts: asNumber(raw?.attempts),
        inputTokens: asNumber(raw?.usage?.inputTokens),
        outputTokens: asNumber(raw?.usage?.outputTokens),
        latencyMs: asNumber(raw?.usage?.latencyMs) ?? asNumber(raw?.latencyMs),
        scores: row.scores,
      };
    });
  }
}
