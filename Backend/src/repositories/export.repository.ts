import type { ExportEvaluation } from '../domain/export.js';

/** Dışa aktarma için salt okunur sorgu: hiçbir şey yazmaz. */
export interface ExportRepository {
  /** Tüm puanlama kayıtları (başarılı ve başarısız), kimlik sırasıyla. */
  listEvaluations(): Promise<ExportEvaluation[]>;
}
