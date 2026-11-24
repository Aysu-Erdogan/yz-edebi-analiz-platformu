import { describe, expect, it } from 'vitest';
import { createRubricService } from '../src/services/rubric.service.js';
import { runRubricCli } from '../src/services/rubric-cli.js';
import { InMemoryRubricRepository } from './fakes/in-memory-rubric.repository.js';

const levels = [
  { score: 1, descriptor: 'en düşük' },
  { score: 5, descriptor: 'en yüksek' },
];
const rubric = (genre = 'siir', version = '1.0') => ({
  genre,
  version,
  scale: { min: 1, max: 5 },
  criteria: [
    { key: 'imge', label: 'İmge', description: 'imge gücü', weight: 0.5, levels },
    { key: 'ritim', label: 'Ritim', description: 'ahenk', weight: 0.3, levels },
    { key: 'ozgun', label: 'Özgünlük', description: 'özgünlük', weight: 0.2, levels },
  ],
});

function setup(files: Record<string, string> = {}) {
  const rubrics = createRubricService(new InMemoryRubricRepository());
  const logs: string[] = [];
  const read = (path: string): string => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path} bulunamadı`);
    return content;
  };
  const run = (...argv: string[]) => runRubricCli(argv, { rubrics, read }, (l) => logs.push(l));
  return { rubrics, run, out: () => logs.join('\n') };
}

describe('rubrik komut satırı', () => {
  it('listele: kayıt yokken bunu söyler', async () => {
    const { run, out } = setup();
    expect(await run('listele')).toBe(0);
    expect(out()).toContain('Kayıtlı rubrik yok');
  });

  it('yukle: tek rubrik dosyasını yükler, etkinleştirmez; listele durumunu gösterir', async () => {
    const { rubrics, run, out } = setup({ 'a.json': JSON.stringify(rubric('siir', '1.0')) });
    expect(await run('yukle', 'a.json')).toBe(0);
    expect(out()).toContain('siir 1.0 yüklendi');
    expect((await rubrics.listRubrics())[0]).toMatchObject({ genre: 'siir', status: 'draft' });
    expect(await run('listele')).toBe(0);
    expect(out()).toContain('siir 1.0');
    expect(out()).toContain('draft');
  });

  it('yukle --etkinlestir: etkinleştirir, aynı türdeki önceki etkin rubrik arşivlenir, yeniden puanlama ipucu verilir', async () => {
    const { rubrics, run, out } = setup({
      'eski.json': JSON.stringify(rubric('siir', '1.0')),
      'yeni.json': JSON.stringify(rubric('siir', '2.0')),
    });
    expect(await run('yukle', 'eski.json', '--etkinlestir')).toBe(0);
    expect(await run('yukle', 'yeni.json', '--etkinlestir')).toBe(0);
    const all = await rubrics.listRubrics();
    expect(all.find((r) => r.version === '2.0')?.status).toBe('active');
    expect(all.find((r) => r.version === '1.0')?.status).toBe('archived');
    expect(out()).toContain('etkinleştirildi');
    expect(out()).toContain('npm run batch -- puanla');
  });

  it('listele: değerlendirmede kullanılmış rubriği "kullanıldı" diye gösterir', async () => {
    const { rubrics, run, out } = setup({ 'a.json': JSON.stringify(rubric()) });
    await run('yukle', 'a.json');
    expect(await run('listele')).toBe(0);
    expect(out()).toContain('kullanılmadı');
    await rubrics.markUsed((await rubrics.listRubrics())[0]!.id);
    expect(await run('listele')).toBe(0);
    expect(out().split('\n').at(-1)).toContain('· kullanıldı');
  });

  it('yukle: bir dosyada rubrik dizisi ve birden çok dosya kabul edilir', async () => {
    const { rubrics, run, out } = setup({
      'uc.json': JSON.stringify([rubric('siir'), rubric('hikaye')]),
      'deneme.json': JSON.stringify(rubric('deneme')),
    });
    expect(await run('yukle', 'uc.json', 'deneme.json', '--etkinlestir')).toBe(0);
    const all = await rubrics.listRubrics();
    expect(all.map((r) => r.genre).sort()).toEqual(['deneme', 'hikaye', 'siir']);
    expect(all.every((r) => r.status === 'active')).toBe(true);
    expect(out().match(/yüklendi/g)).toHaveLength(3);
  });

  it('aynı tür ve sürüm ikinci kez yüklenirse hata verir (1), ötekiler yine de yüklenir', async () => {
    const { rubrics, run, out } = setup({
      'a.json': JSON.stringify([rubric('siir', '1.0'), rubric('hikaye', '1.0')]),
    });
    await run('yukle', 'a.json');
    expect(await run('yukle', 'a.json')).toBe(1);
    expect(out()).toContain('zaten var');
    expect(await rubrics.listRubrics()).toHaveLength(2);
  });

  it('bozuk JSON ve şemaya uymayan rubrik hata verir (1), hiçbir şey yüklenmez, neden yazılır', async () => {
    const bad = { ...rubric('siir', '1.0'), criteria: [] };
    const { rubrics, run, out } = setup({
      'bozuk.json': '{ bu json degil',
      'sema.json': JSON.stringify(bad),
    });
    expect(await run('yukle', 'bozuk.json')).toBe(1);
    expect(out()).toContain('bozuk.json');
    expect(out()).toContain('geçerli JSON değil');
    expect(await run('yukle', 'sema.json')).toBe(1);
    expect(out()).toContain('sema.json');
    expect(out()).toContain('criteria');
    expect(await rubrics.listRubrics()).toHaveLength(0);
  });

  it('olmayan dosya hata verir (1)', async () => {
    const { run, out } = setup();
    expect(await run('yukle', 'yok.json')).toBe(1);
    expect(out()).toContain('yok.json');
  });

  it('hatalı kullanım 2 döner ve kullanımı yazar: komutsuz, bilinmeyen komut, dosyasız yukle, bilinmeyen seçenek', async () => {
    for (const argv of [
      [],
      ['sil'],
      ['yukle'],
      ['yukle', '--yok', 'a.json'],
      ['listele', 'fazla'],
    ]) {
      const { run, out } = setup({ 'a.json': JSON.stringify(rubric()) });
      expect(await run(...argv), argv.join(' ')).toBe(2);
      expect(out()).toContain('Kullanım: npm run rubric');
    }
  });

  it('etkinleştirme yüklemeden sonra yapılır: yükleme hatası olan rubrik etkinleştirilmez', async () => {
    const { rubrics, run } = setup({ 'a.json': JSON.stringify(rubric('siir', '1.0')) });
    await run('yukle', 'a.json');
    expect(await run('yukle', 'a.json', '--etkinlestir')).toBe(1); // zaten var
    expect((await rubrics.listRubrics())[0]?.status).toBe('draft');
  });
});
