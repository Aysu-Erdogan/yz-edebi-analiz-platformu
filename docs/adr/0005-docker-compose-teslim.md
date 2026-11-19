# ADR 0005: Teslim biçimi Docker Compose

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

Sistem hem bitirme jürisi hem TÜBİTAK hakemi için çalıştırılabilir ve **tekrarlanabilir** olmalı. Sunum günü ortam sürprizleri riskli. Barındırma seçeneği (okul sunucusu ya da küçük bir VPS) henüz kesin değil.

## Karar

- Birincil teslim: `docker compose up --build` ile MySQL + backend + frontend (nginx) birlikte kalkar.
- Backend kapsayıcısı açılışta `prisma migrate deploy` çalıştırır, başarısızsa sunucu açılmaz.
- Çevrimiçi demo aynı Compose dosyasıyla tek bir sunucuda çalıştırılır.
- CI, Compose'u kurup arayüz üzerinden `/api/v1/health` çağrısıyla uçtan uca doğrular.

## Sonuçlar

- Aynı paket yerelde, okul sunucusunda ve VPS'te çalışır.
- Geliştirici makinesinde Docker gerekir. Docker kurulu değilse bileşenler tek tek (MySQL + `npm run dev`) çalıştırılabilir.
