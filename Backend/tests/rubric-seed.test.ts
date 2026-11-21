import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { GENRES } from '../src/domain/rubric.js';
import { seedRubrics } from '../src/seed/rubric-seed.js';
import { createRubricService, type RubricService } from '../src/services/rubric.service.js';
import { sampleRubric } from './contracts/rubric-repository.contract.js';
import { InMemoryRubricRepository } from './fakes/in-memory-rubric.repository.js';

const dir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../prisma/seed-data/rubrics/v0.1-taslak',
);
const drafts: unknown[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')));

describe('taslak rubrik seed', () => {
  let service: RubricService;
  beforeEach(() => {
    service = createRubricService(new InMemoryRubricRepository());
  });

  it('üç türün taslak rubriğini yükler ve her tür için etkin yapar', async () => {
    expect(await seedRubrics(service, drafts)).toEqual({ created: 3, skipped: 0 });
    for (const genre of GENRES) {
      const active = await service.getActiveRubric(genre);
      expect(active.version).toBe('0.1-taslak');
      expect(active.sourceNote).toContain('GEÇİCİ TASLAK');
    }
  });

  it('ikinci çalıştırmada hiçbir şey eklemez, mevcut kayıtlara dokunmaz (tekrarlanabilir)', async () => {
    await seedRubrics(service, drafts);
    expect(await seedRubrics(service, drafts)).toEqual({ created: 0, skipped: 3 });
    expect(await service.listRubrics()).toHaveLength(3);
  });

  it('türde zaten etkin bir rubrik varsa onu arşivlemez, taslağı etkinleştirmeden bırakır', async () => {
    const real = await service.importRubric(sampleRubric('siir', '1.0'));
    await service.activateRubric(real.id);

    await seedRubrics(service, drafts);

    expect((await service.getActiveRubric('siir')).id).toBe(real.id);
    const siirDraft = (await service.listRubrics({ genre: 'siir' })).find(
      (r) => r.version === '0.1-taslak',
    );
    expect(siirDraft?.status).toBe('draft');
    // Diğer türler normal yüklenir.
    expect((await service.getActiveRubric('hikaye')).version).toBe('0.1-taslak');
  });

  it('geçersiz rubrik yüklemeyi durdurur (sessizce atlamaz)', async () => {
    await expect(seedRubrics(service, [{ genre: 'siir' }])).rejects.toThrow();
  });
});
