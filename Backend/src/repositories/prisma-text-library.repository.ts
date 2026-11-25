import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../lib/prisma.js';
import type {
  LibraryText,
  LibraryTextDetail,
  TextFilter,
  TextLibraryRepository,
} from './text-library.repository.js';

const authorSelect = {
  generation: {
    select: { providerModel: { select: { provider: true, modelId: true, displayName: true } } },
  },
} as const;

/** MySQL (Prisma) metin kütüphanesi. */
export class PrismaTextLibraryRepository implements TextLibraryRepository {
  constructor(private readonly db: Db) {}

  // shortcut: tüm süzgeçli metinler (gövdeleriyle) tek sorguda okunur; yüzlerce metin için yeter, binlerce
  // metinde sayfalama gerekir.
  async list(filter: TextFilter): Promise<LibraryText[]> {
    const where: Prisma.TextWhereInput = {
      ...(filter.genre && { genre: filter.genre }),
      ...(filter.theme && { theme: filter.theme }),
      ...(filter.source && { source: filter.source }),
    };
    const rows = await this.db.text.findMany({
      where,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        genre: true,
        theme: true,
        source: true,
        label: true,
        body: true,
        createdAt: true,
        ...authorSelect,
        _count: { select: { evaluations: { where: { status: 'succeeded' } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      genre: row.genre,
      theme: row.theme,
      source: row.source,
      label: row.label,
      author: row.generation?.providerModel ?? null,
      body: row.body,
      createdAt: row.createdAt,
      succeededEvaluations: row._count.evaluations,
    }));
  }

  async get(id: number): Promise<LibraryTextDetail | null> {
    const row = await this.db.text.findUnique({
      where: { id },
      select: {
        id: true,
        genre: true,
        theme: true,
        source: true,
        label: true,
        body: true,
        createdAt: true,
        generation: {
          select: {
            replicateNo: true,
            inputTokens: true,
            outputTokens: true,
            latencyMs: true,
            promptTemplate: { select: { version: true } },
            providerModel: { select: { provider: true, modelId: true, displayName: true } },
          },
        },
        evaluations: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            evaluatorRef: true,
            replicateNo: true,
            status: true,
            error: true,
            totalScore: true,
            createdAt: true,
            promptTemplate: { select: { version: true } },
            rubric: {
              select: {
                version: true,
                criteria: { select: { key: true, label: true, sortOrder: true } },
              },
            },
            scores: { select: { criterionKey: true, score: true, comment: true } },
          },
        },
      },
    });
    if (!row) return null;

    return {
      id: row.id,
      genre: row.genre,
      theme: row.theme,
      source: row.source,
      label: row.label,
      author: row.generation?.providerModel ?? null,
      body: row.body,
      createdAt: row.createdAt,
      succeededEvaluations: row.evaluations.filter((e) => e.status === 'succeeded').length,
      generation: row.generation && {
        templateVersion: row.generation.promptTemplate.version,
        replicateNo: row.generation.replicateNo,
        inputTokens: row.generation.inputTokens,
        outputTokens: row.generation.outputTokens,
        latencyMs: row.generation.latencyMs,
      },
      evaluations: row.evaluations.map((e) => {
        // Kriterler rubrikteki sırayla; rubrikte olmayan anahtar (olmamalı) sona ve anahtarıyla düşer.
        const order = new Map(e.rubric.criteria.map((c) => [c.key, c]));
        const scores = [...e.scores]
          .sort(
            (a, b) =>
              (order.get(a.criterionKey)?.sortOrder ?? Infinity) -
              (order.get(b.criterionKey)?.sortOrder ?? Infinity),
          )
          .map((s) => ({
            key: s.criterionKey,
            label: order.get(s.criterionKey)?.label ?? s.criterionKey,
            score: s.score,
            comment: s.comment,
          }));
        return {
          id: e.id,
          judge: e.evaluatorRef,
          rubricVersion: e.rubric.version,
          templateVersion: e.promptTemplate?.version ?? null,
          replicateNo: e.replicateNo,
          status: e.status,
          error: e.error,
          totalScore: e.totalScore,
          scores,
          createdAt: e.createdAt,
        };
      }),
    };
  }
}
