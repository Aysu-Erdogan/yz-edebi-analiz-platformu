# ADR 0006: TypeScript 6.0'a sabitleme

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

Kurulum sırasında npm'in en güncel TypeScript'i (7.x) seçtiği görüldü. `typescript-eslint` 8.72'nin TypeScript eş bağımlılık aralığı `>=4.8.4 <6.1.0`, yani 7.x ile uyumsuz. Lint'siz bir proje kalite hedeflerine aykırı.

## Karar

Hem Backend hem Frontend'de TypeScript **`~6.0.3`** sürümüne sabitlenir. `typescript-eslint` TypeScript 7'yi destekleyince sürüm yükseltilir (yükseltme ayrı bir görev olarak izlenir).

## Sonuçlar

- Lint, tip kontrolü ve derleme aynı derleyici sürümüyle tutarlı çalışır.
- En yeni derleyici özellikleri geç gelir (kabul edilen küçük maliyet).
- Bilinen not: `npm audit`, ESLint zincirindeki `minimatch` için yalnızca **geliştirme zamanı** orta seviye uyarılar verir. Üretim paketine girmez, düzenli kontrol edilir.
