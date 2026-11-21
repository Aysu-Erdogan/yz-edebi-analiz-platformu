import type { Db } from '../../src/lib/prisma.js';

/**
 * Model, şablon ve üretim tablolarını bağımlılık sırasıyla boşaltır (önce metinler ve üretimler, sonra
 * onların başvurduğu modeller ve şablonlar). Yalnızca test veritabanında çağrılır.
 */
export async function cleanGenerationData(db: Db): Promise<void> {
  await db.text.deleteMany();
  await db.generation.deleteMany();
  await db.providerModel.deleteMany();
  await db.promptTemplate.deleteMany();
}
