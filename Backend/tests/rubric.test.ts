import { describe, expect, it } from 'vitest';
import { rubricInputSchema } from '../src/domain/rubric.js';

/** Her testte değiştirilebilsin diye her çağrıda yeni, geçerli bir rubrik döner. */
function validRubric() {
  const levels = (a: string, b: string, c: string) => [
    { score: 1, descriptor: a },
    { score: 3, descriptor: b },
    { score: 5, descriptor: c },
  ];
  return {
    genre: 'siir',
    version: '0.1-taslak',
    sourceNote: 'GEÇİCİ TASLAK: uzman doğrulaması yok',
    scale: { min: 1, max: 5 },
    criteria: [
      {
        key: 'imgeGucu',
        label: 'İmge Gücü',
        description: 'Metafor, benzetme ve sembollerin kalitesi',
        weight: 0.5,
        levels: levels(
          'İmge yok ya da klişe.',
          'Bazı özgün imgeler var.',
          'Özgün ve tutarlı imgeler.',
        ),
      },
      {
        key: 'ritimAhenk',
        label: 'Ritim ve Ahenk',
        description: 'Ses, ölçü ve akıcılık',
        weight: 0.5,
        levels: levels('Ritim yok.', 'Ritim dalgalı.', 'Ritim ve ahenk belirgin.'),
      },
    ],
  };
}

type Rubric = ReturnType<typeof validRubric>;

/** Şemayı çalıştırır, hata mesajlarını ve yollarını düz metin olarak döner. */
function issuesOf(input: unknown): string[] {
  const result = rubricInputSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('rubrik şeması (T01, T02)', () => {
  it('T01: geçerli rubrik kabul edilir', () => {
    expect(rubricInputSchema.safeParse(validRubric()).success).toBe(true);
  });

  it('T01: kaynak notu isteğe bağlıdır', () => {
    const r: Partial<Rubric> = validRubric();
    delete r.sourceNote;
    expect(rubricInputSchema.safeParse(r).success).toBe(true);
  });

  it('T02: ağırlık toplamı 1 değilse reddedilir ve toplam mesajda görünür', () => {
    const r = validRubric();
    r.criteria[0]!.weight = 0.6; // toplam 1.1
    const issues = issuesOf(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^criteria: .*toplam.*1\.1/);
  });

  it('ağırlık toplamı ondalık yuvarlama farkıyla 1 ise kabul edilir (0.1 + 0.2 + 0.7)', () => {
    const r = validRubric();
    r.criteria = [
      { ...r.criteria[0]!, weight: 0.1 },
      { ...r.criteria[1]!, weight: 0.2 },
      { ...r.criteria[1]!, key: 'ucuncu', weight: 0.7 },
    ];
    expect(rubricInputSchema.safeParse(r).success).toBe(true);
  });

  it('T02: eksik alan reddedilir ve eksik alanın yolu söylenir', () => {
    const r = validRubric() as Record<string, unknown>;
    delete r.criteria;
    expect(issuesOf(r).join('\n')).toContain('criteria');

    const r2 = validRubric();
    delete (r2.criteria[0] as Record<string, unknown>).label;
    expect(issuesOf(r2).join('\n')).toContain('criteria.0.label');
  });

  it('bilinmeyen alan (yazım hatası) sessizce yok sayılmaz, reddedilir', () => {
    const r = { ...validRubric(), wieght: 1 };
    expect(rubricInputSchema.safeParse(r).success).toBe(false);
  });

  it('bilinmeyen tür reddedilir; Türkçe karakterli "şiir" de geçerli tür değildir', () => {
    expect(rubricInputSchema.safeParse({ ...validRubric(), genre: 'roman' }).success).toBe(false);
    expect(rubricInputSchema.safeParse({ ...validRubric(), genre: 'şiir' }).success).toBe(false);
    expect(rubricInputSchema.safeParse({ ...validRubric(), genre: 'hikaye' }).success).toBe(true);
    expect(rubricInputSchema.safeParse({ ...validRubric(), genre: 'deneme' }).success).toBe(true);
  });

  it('kriter anahtarları tekrar edemez', () => {
    const r = validRubric();
    r.criteria[1]!.key = r.criteria[0]!.key;
    expect(issuesOf(r).join('\n')).toMatch(/criteria\.1\.key: .*imgeGucu/);
  });

  it('kriter anahtarı OpenAPI örüntüsüne uymalıdır (harfle başlar, yalnızca harf ve rakam)', () => {
    for (const bad of ['1ilk', 'imge gucu', 'imge-gucu', 'imgeGüçü', '']) {
      const r = validRubric();
      r.criteria[0]!.key = bad;
      expect(rubricInputSchema.safeParse(r).success, bad).toBe(false);
    }
  });

  it('ağırlık sıfır ya da negatif olamaz', () => {
    for (const w of [0, -0.5]) {
      const r = validRubric();
      r.criteria[0]!.weight = w;
      expect(rubricInputSchema.safeParse(r).success, String(w)).toBe(false);
    }
  });

  it('kriter listesi boş olamaz', () => {
    expect(rubricInputSchema.safeParse({ ...validRubric(), criteria: [] }).success).toBe(false);
  });

  it('ölçek: en küçük değer en büyükten küçük olmalı', () => {
    expect(
      rubricInputSchema.safeParse({ ...validRubric(), scale: { min: 5, max: 5 } }).success,
    ).toBe(false);
    expect(
      rubricInputSchema.safeParse({ ...validRubric(), scale: { min: 5, max: 1 } }).success,
    ).toBe(false);
    expect(
      rubricInputSchema.safeParse({ ...validRubric(), scale: { min: 1, max: 4 } }).success,
    ).toBe(false); // düzeyler 5 içeriyor
  });

  it('düzey puanı ölçeğin dışında olamaz', () => {
    const r = validRubric();
    r.criteria[0]!.levels[2]!.score = 6;
    expect(issuesOf(r).join('\n')).toMatch(/criteria\.0\.levels\.2\.score: .*1.*5/);
  });

  it('düzey puanları tekrar edemez (hata ikinci görülen kayda bağlanır)', () => {
    const r = validRubric();
    r.criteria[0]!.levels[1]!.score = 5; // düzeyler: 1, 5, 5
    expect(issuesOf(r).join('\n')).toMatch(/criteria\.0\.levels\.2\.score: .*tekrar/);
  });

  it('her kriter ölçeğin en düşük ve en yüksek düzeyini tanımlamalı (çapa düzeyleri)', () => {
    const r = validRubric();
    r.criteria[0]!.levels = r.criteria[0]!.levels.filter((l) => l.score !== 5);
    expect(issuesOf(r).join('\n')).toMatch(/criteria\.0\.levels: .*5/);
  });

  it('düzey açıklaması boş olamaz', () => {
    const r = validRubric();
    r.criteria[0]!.levels[0]!.descriptor = '   ';
    expect(rubricInputSchema.safeParse(r).success).toBe(false);
  });

  it('sürüm boş olamaz ve URL için güvenli karakterler içermelidir', () => {
    for (const bad of ['', ' ', 'v 1', '0.1/taslak', 'a'.repeat(33)]) {
      expect(rubricInputSchema.safeParse({ ...validRubric(), version: bad }).success, bad).toBe(
        false,
      );
    }
    expect(rubricInputSchema.safeParse({ ...validRubric(), version: '1.0' }).success).toBe(true);
  });
});
