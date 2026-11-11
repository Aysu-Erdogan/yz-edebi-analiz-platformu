# ADR 0002: MySQL ve Prisma

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

TÜBİTAK önerisi MySQL kullanımını taahhüt ediyor (kullanıcı girdileri ve rubrik sonuçlarının saklanması). Geliştirme makinesinde MySQL 8 kurulu. Veri modeli ilişkisel: metin, üretim, değerlendirme, rubrik, puan.

## Karar

- Veritabanı **MySQL 8** (utf8mb4, Türkçe karakter için `utf8mb4_unicode_ci`).
- Erişim katmanı **Prisma 7** (sürücü adaptörü: `@prisma/adapter-mariadb`). Şema `Backend/prisma/schema.prisma`, migration'lar `Backend/prisma/migrations`.
- Migration'lar elle düzenlenmez. Şema değişikliği = yeni migration.
- CI'da migration'lar gerçek bir MySQL servisine uygulanarak doğrulanır.

## Sonuçlar

- Tip güvenli sorgular, otomatik migration geçmişi.
- Prisma 7'de bağlantı adresi `prisma.config.ts` içinde, istemci ise sürücü adaptörüyle oluşturulur (eski sürümlerden farklı).
- PostgreSQL'e geçmek istenirse şema ve adaptör değişir, uygulama kodu büyük ölçüde aynı kalır.
