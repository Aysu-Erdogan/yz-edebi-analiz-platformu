import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * axe-core ile erişilebilirlik denetimi (WCAG 2.0/2.1/2.2 A ve AA kuralları + en iyi uygulamalar).
 * jsdom yerleşim hesaplamadığı için renk kontrastı ve taşma kuralları burada kapalıdır; onlar gerçek tarayıcıda
 * denetlenir (rapor bölüm 3.14). Burada yapı kuralları çalışır: ad, etiket, başlık, tablo, rol, kimlik, dil.
 */
export async function expectNoA11yViolations(
  context: Element | Document = document,
): Promise<void> {
  const results = await axe.run(context, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: {
      'color-contrast': { enabled: false },
      'scrollable-region-focusable': { enabled: false },
    },
  });
  const messages = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.html.slice(0, 120)}`).join('\n')}`,
  );
  // Başarısızlıkta ihlaller okunur biçimde görünsün.
  expect(messages, `\n${messages.join('\n')}`).toEqual([]);
}
