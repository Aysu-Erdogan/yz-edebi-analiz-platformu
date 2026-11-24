import { beforeEach, describe, expect, it, vi } from 'vitest';
import { A, B, condition } from '../../test/analytics-fixture';
import { barConfig, modelStyle, radarConfig } from './charts';
import { heatTable } from './data';

beforeEach(() => {
  // jsdom canvas çizemez; desen üretimi renge düşer.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('modelStyle', () => {
  it('ilk üç model farklı işaret ve desen alır, dördüncü başa sarar', () => {
    const marks = [0, 1, 2].map((i) => modelStyle(i).mark);
    expect(new Set(marks).size).toBe(3);
    expect(modelStyle(3)).toEqual(modelStyle(0));
    expect(modelStyle(0).pattern).toBe('none');
    expect(modelStyle(1).pattern).toBe('hatch');
    expect(modelStyle(2).pattern).toBe('dots');
  });

  it('renk CSS değişkeninden okunur, yoksa ADR 0008 değerine düşer', () => {
    expect(modelStyle(0).color).toBe('#b84f00');
    document.documentElement.style.setProperty('--color-model-1', '#123456');
    expect(modelStyle(0).color).toBe('#123456');
    document.documentElement.style.removeProperty('--color-model-1');
  });
});

describe('barConfig', () => {
  // İşlev: yapılandırma test içinde kurulsun, `getContext` sahtesi (beforeEach) devrede olsun.
  const build = () => barConfig(heatTable(condition, 'tür '));

  it('her model bir seri, her tür bir etiket; eksik hücre null kalır', () => {
    const config = build();
    expect(config.data.labels).toEqual(['Şiir', 'Hikâye']);
    expect(config.data.datasets.map((d) => d.label)).toEqual(['claude-a', 'gemini-b']);
    expect(config.data.datasets[0]!.data).toEqual([80, 60]);
    expect(config.data.datasets[1]!.data).toEqual([40, null]);
  });

  it('ölçek 0-100 ve kütüphanenin kendi göstergesi kapalıdır (gösterge HTML olarak yazılır)', () => {
    const config = build();
    expect(config.options?.scales?.y).toMatchObject({ min: 0, max: 100 });
    expect(config.options?.plugins?.legend?.display).toBe(false);
  });
});

describe('radarConfig', () => {
  const profile = condition.profiller[0]!;
  const labelOf = (k: string) => (k === 'imge' ? 'İmge gücü' : k);
  const config = radarConfig(profile, [A, B], labelOf, 5);

  it('eksenler kriter adlarıdır; ölçülmeyen kriter null olur', () => {
    expect(config.data.labels).toEqual(['İmge gücü', 'ritim']);
    expect(config.data.datasets[1]!.data).toEqual([2, null]);
  });

  it('modelin rengi, grafikler arasında yazar sırasına göre sabittir', () => {
    // Yalnızca B'nin olduğu profilde bile B ikinci modelin rengini ve işaretini taşır.
    const only = radarConfig({ ...profile, gruplar: [profile.gruplar[1]!] }, [A, B], labelOf, 5);
    expect(only.data.datasets[0]!.borderColor).toBe(modelStyle(1).color);
    expect(only.data.datasets[0]!.pointStyle).toBe('rect');
  });

  it('ölçek 0 ile rubrikteki üst sınır arasındadır', () => {
    expect(config.options?.scales?.r).toMatchObject({ min: 0, max: 5 });
  });
});
