import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  generationVars,
  placeholdersOf,
  promptTemplateInputSchema,
  renderPrompt,
} from '../src/domain/prompt.js';

const body = 'Tür: {{tur}}\nTema: {{tema}}\nUzunluk: {{uzunluk}}';
const vars = { tur: 'şiir', tema: 'Sonbahar', uzunluk: '3-5 kıta' };

describe('şablon doldurma', () => {
  it('boşlukları değerlerle doldurur; aynı girdi her zaman aynı soruyu verir', () => {
    const expected = 'Tür: şiir\nTema: Sonbahar\nUzunluk: 3-5 kıta';
    expect(renderPrompt(body, vars)).toBe(expected);
    expect(renderPrompt(body, vars)).toBe(expected);
  });

  it('aynı boşluk birden çok yerde geçerse hepsini doldurur', () => {
    expect(renderPrompt('{{tema}} ve yine {{tema}}', { tema: 'deniz' })).toBe(
      'deniz ve yine deniz',
    );
  });

  it('eksik değer hata verir ve eksik alanları söyler (yarım dolu soru modele gitmez)', () => {
    expect(() => renderPrompt(body, { tur: 'şiir' })).toThrow(/tema.*uzunluk/s);
  });

  it('şablonda olmayan fazla değer hata verir (yazım hatasını yakalar)', () => {
    expect(() => renderPrompt(body, { ...vars, temaa: 'x' })).toThrow(/temaa/);
  });

  it('değerin içindeki {{...}} yeniden doldurulmaz (şablon enjeksiyonu olmaz)', () => {
    const out = renderPrompt(body, { ...vars, tema: '{{tur}}' });
    expect(out).toContain('Tema: {{tur}}');
    expect(out).toContain('Tür: şiir');
  });

  it('placeholdersOf: boşlukları sıralı ve tekrarsız listeler', () => {
    expect(placeholdersOf('{{b}} {{a}} {{b}}')).toEqual(['a', 'b']);
    expect(placeholdersOf('boşluk yok')).toEqual([]);
  });
});

describe('üretim değişkenleri', () => {
  it('her tür için ad ve uzunluk verir, temayı olduğu gibi aktarır', () => {
    expect(generationVars('siir', 'Sonbahar')).toEqual({
      tur: 'şiir',
      tema: 'Sonbahar',
      uzunluk: '3-5 kıta',
    });
    expect(generationVars('hikaye', 'Göç').tur).toBe('hikâye');
    expect(generationVars('deneme', 'Zaman').uzunluk).toBe('yaklaşık 250-350 sözcük');
  });

  it('temayı kırpar; boş, çok uzun ve çok satırlı tema reddedilir (sorunun yapısı bozulmasın)', () => {
    expect(generationVars('siir', '  Deniz  ').tema).toBe('Deniz');
    // Veritabanındaki tema alanı en çok 32 karakter (texts.theme, generations.theme).
    expect(generationVars('siir', 'a'.repeat(32)).tema).toHaveLength(32);
    for (const bad of ['', '   ', 'a'.repeat(33), 'iki\nsatır', 'satır\rsonu']) {
      expect(() => generationVars('siir', bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('şablon kaydı şeması', () => {
  const valid = { kind: 'generate', version: 'v1', body };

  it('geçerli şablonu kabul eder', () => {
    expect(promptTemplateInputSchema.safeParse(valid).success).toBe(true);
  });

  it('zorunlu boşluklardan biri eksikse reddeder (tema yok sayılan şablon olmaz)', () => {
    const missing = { ...valid, body: 'Tür: {{tur}}\nUzunluk: {{uzunluk}}' };
    const result = promptTemplateInputSchema.safeParse(missing);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join(' ')).toContain('tema');
  });

  it('tanımsız boşluğu reddeder', () => {
    const unknown = { ...valid, body: `${body}\n{{bilinmeyen}}` };
    expect(promptTemplateInputSchema.safeParse(unknown).success).toBe(false);
  });

  it('geçersiz sürüm, boş gövde ve bilinmeyen alanı reddeder', () => {
    for (const bad of [
      { ...valid, version: '' },
      { ...valid, version: 'v 1' },
      { ...valid, body: '' },
      { ...valid, yazimHatasi: 1 },
      { ...valid, kind: 'bilinmeyen' },
    ]) {
      expect(promptTemplateInputSchema.safeParse(bad).success).toBe(false);
    }
  });

  describe('yargıç şablonu (F2)', () => {
    const judgeBody =
      'Tür: {{tur}}\nTema: {{tema}}\nÖlçek: {{olcek}}\n{{kriterler}}\n<metin>{{metin}}</metin>';
    const judge = { kind: 'judge', version: 'v1', body: judgeBody };

    it('kendi zorunlu boşluklarıyla kabul edilir', () => {
      expect(promptTemplateInputSchema.safeParse(judge).success).toBe(true);
    });

    it('metin ya da kriter boşluğu eksikse reddedilir (metni içermeyen yargıç komutu olmaz)', () => {
      for (const name of ['metin', 'kriterler', 'olcek', 'tema', 'tur']) {
        const body = judgeBody.replace(`{{${name}}}`, '');
        const result = promptTemplateInputSchema.safeParse({ ...judge, body });
        expect(result.success, name).toBe(false);
        expect(result.error?.issues.map((i) => i.message).join(' ')).toContain(name);
      }
    });

    it('üretim şablonunun boşlukları yargıç için tanımsızdır, yargıç boşlukları üretim için de', () => {
      expect(
        promptTemplateInputSchema.safeParse({ ...judge, body: `${judgeBody}\n{{uzunluk}}` })
          .success,
      ).toBe(false);
      expect(promptTemplateInputSchema.safeParse({ ...valid, body: judgeBody }).success).toBe(
        false,
      );
    });
  });
});

describe('ilk şablon (seed verisi)', () => {
  const file = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../prisma/seed-data/prompts/generate-v1.json',
  );
  const template = JSON.parse(readFileSync(file, 'utf8')) as unknown;

  it('şemaya uyar ve her tür için doldurulabilir', () => {
    const parsed = promptTemplateInputSchema.parse(template);
    expect(parsed.version).toBe('v1');
    for (const genre of ['siir', 'hikaye', 'deneme'] as const) {
      const prompt = renderPrompt(parsed.body, generationVars(genre, 'Sonbahar'));
      expect(prompt).not.toContain('{{');
      expect(prompt).toContain('Sonbahar');
    }
  });

  it('tarafsızdır: rol verme ("sen bir yazarsın") ve yönlendirme içermez', () => {
    const { body: text } = promptTemplateInputSchema.parse(template);
    expect(text.toLowerCase()).not.toMatch(/sen (bir|deneyimli|ünlü)/);
  });
});
