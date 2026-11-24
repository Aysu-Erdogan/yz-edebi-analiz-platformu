import type { Db } from '../../src/lib/prisma.js';

/**
 * Model, şablon ve üretim tablolarını bağımlılık sırasıyla boşaltır (önce metinler ve üretimler, sonra
 * onların başvurduğu modeller ve şablonlar). Metinler silinince değerlendirmeleri ve puanları zincirleme
 * silinir. Yalnızca test veritabanında çağrılır.
 */
export async function cleanGenerationData(db: Db): Promise<void> {
  await db.text.deleteMany();
  await db.generation.deleteMany();
  await db.providerModel.deleteMany();
  await db.promptTemplate.deleteMany();
}

/**
 * Değerlendirmeleri, üretim verisini ve rubrikleri boşaltır. Rubrikler değerlendirmelerden önce silinemez
 * (değerlendirme rubriğe bağlıdır), bu yüzden değerlendirmeler önce temizlenir.
 */
export async function cleanRubricData(db: Db): Promise<void> {
  await db.evaluation.deleteMany();
  await cleanGenerationData(db);
  await db.rubric.deleteMany();
}
