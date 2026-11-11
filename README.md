# YZ Edebi Analiz Platformu

Üretken yapay zekâ modellerinin (ChatGPT, Claude, Gemini) **Türkçe şiir, hikâye ve deneme** üretimindeki performansını, **değiştirilebilir bir rubrikle** puanlayıp karşılaştıran web platformu.

TÜBİTAK 2209-A projesi _"Üretken Yapay Zekâ Modellerinin Türk Edebiyatı Açısından Performanslarını Karşılaştırmaya Yönelik Rubrik Geliştirilmesi ve Performans Analizi"_ kapsamında, aynı zamanda bitirme projesi olarak geliştirilmektedir. Danışman: Dr. Öğr. Üyesi Ahmet Yusuf Cevher, Ardahan Üniversitesi.

> **Durum:** Faz 0 (iskelet) tamamlandı. Backend ve Frontend iskeletleri, veri modeli, Docker, CI ve belgeler hazır. Özellikler [iş planına](docs/IS_PLANI.md) göre fazlar halinde eklenecek.

## Belgeler

| Belge                                              | İçerik                                                    |
| -------------------------------------------------- | --------------------------------------------------------- |
| [docs/IS_PLANI.md](docs/IS_PLANI.md)               | Uçtan uca iş planı, takvim, test stratejisi, 38 senaryo   |
| [docs/adr/](docs/adr/README.md)                    | Mimari karar kayıtları ("neden böyle yaptık?")            |
| [docs/diyagramlar/er.md](docs/diyagramlar/er.md)   | Veri modeli (ER diyagramı)                                |
| [docs/diyagramlar/uml.md](docs/diyagramlar/uml.md) | Kullanım durumu, sınıf, sıralama, durum, etkinlik, dağıtım |
| [docs/openapi.yaml](docs/openapi.yaml)             | API sözleşmesi (hedef; `x-status` ile uygulanan/planlanan) |

## Yapı

```
Backend/    Express 5 + TypeScript + Prisma (MySQL)   → API
Frontend/   React 19 + Vite + TypeScript + Tailwind   → arayüz
docs/       İş planı, ADR, diyagramlar, OpenAPI
legacy/     İlk JavaScript prototipi (F3'te arayüz parçaları taşınınca silinecek)
.github/    CI (GitHub Actions)
```

## Gereksinimler

- **Node.js 22+** ve npm
- **MySQL 8** (yerelde ya da Docker ile)
- İsteğe bağlı: **Docker Desktop** (tek komutla kurulum için)

## Hızlı başlangıç: Docker Compose

```bash
cp .env.example .env     # isteğe bağlı: sağlayıcı anahtarlarını ve parolaları doldurun
docker compose up --build
```

- Arayüz: <http://localhost:8080>
- API sağlık kontrolü: <http://localhost:8080/api/v1/health>

Backend kapsayıcısı açılışta veritabanı şemasını otomatik uygular.

## Geliştirme ortamı (Docker'sız)

### 1. Bağımlılıkları kur

```bash
npm install                 # kök araçlar: prettier, husky, lint-staged
npm run install:all         # Backend ve Frontend bağımlılıkları
```

### 2. Veritabanı

MySQL Workbench ya da `mysql` komut satırıyla **kendi yönetici hesabınızla** şunları çalıştırın (parolayı kendiniz belirleyin):

```sql
CREATE DATABASE yz_edebi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'yz_app'@'localhost' IDENTIFIED BY 'BURAYA_KENDI_PAROLANIZ';
-- `prisma migrate dev` gölge veritabanı oluşturabilsin diye yz_edebi% deseni verilir.
GRANT ALL PRIVILEGES ON `yz_edebi%`.* TO 'yz_app'@'localhost';
```

Sonra kök dizinde `.env` dosyası oluşturup `DATABASE_URL` değerini yazın:

```bash
cp .env.example .env
# .env içinde: DATABASE_URL=mysql://yz_app:PAROLANIZ@localhost:3306/yz_edebi
```

Şemayı uygulayın:

```bash
cd Backend
npm run db:generate
npm run db:migrate
```

### 3. Çalıştır

```bash
# Terminal 1
cd Backend && npm run dev     # http://localhost:3000/api/v1/health

# Terminal 2
cd Frontend && npm run dev    # http://localhost:5173 (/api istekleri backend'e yönlenir)
```

## Komutlar

Kök dizinden:

| Komut                  | Ne yapar                                                      |
| ---------------------- | ------------------------------------------------------------- |
| `npm run verify`       | Biçim + tip + lint + test + derleme (push öncesi çalıştırın)   |
| `npm run format`       | Prettier ile biçimlendirir                                    |
| `npm run typecheck`    | Backend ve Frontend tip kontrolü                              |
| `npm run lint`         | ESLint                                                        |
| `npm test`             | Birim ve entegrasyon testleri                                 |
| `npm run build`        | Üretim derlemesi                                              |

Her commit öncesi değişen dosyalar otomatik biçimlendirilir (Husky + lint-staged). Her push ve PR'da GitHub Actions biçim, tip, lint, test, derleme, migration ve Docker açılışını doğrular.

## Güvenlik notları

- `.env` dosyası **asla** depoya girmez (`.gitignore`). Anahtarları yalnızca `.env` içine yazın, sohbete, koda veya ekran görüntüsüne koymayın.
- Anahtarı tanımsız sağlayıcı devre dışı sayılır. `DATABASE_URL` eksikse (üretim/geliştirme) sunucu açık bir hata mesajıyla durur.
- Hata yanıtları iç ayrıntı sızdırmaz, ayrıntı yalnızca günlüğe yazılır (`X-Request-Id` ile eşleştirilir).

## Lisans ve atıf

Akademik çalışma. Lisans bilgisi sonradan eklenecektir.
