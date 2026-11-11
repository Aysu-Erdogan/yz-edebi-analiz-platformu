# ADR 0001: TypeScript, Express 5 ve React

**Durum:** Kabul · **Tarih:** 2026-11-11

## Bağlam

İlk prototip JavaScript ile yazıldı. Proje bitirme projesi olarak savunulacak ve ileride (Mayıs'a kadar) genişletilecek. LLM çıktıları, rubrik verisi ve API yanıtları gibi **dış kaynaklı ve değişken veri** çok. TÜBİTAK önerisi Node.js, HTML/CSS/JavaScript ve MySQL diyordu.

## Karar

- Backend: **Node.js 22 + Express 5 + TypeScript**, girdi doğrulaması **zod** ile.
- Frontend: **React 19 + Vite + TypeScript**, yönlendirme **React Router**, sunucu verisi **TanStack Query**, stil **Tailwind CSS**.
- Test: **Vitest** (hem backend hem frontend), HTTP testleri için **Supertest**, bileşenler için **Testing Library**.

## Sonuçlar

- Tip hataları derleme anında yakalanır; rubrik, API ve LLM çıktısı aynı zod şemalarıyla doğrulanır.
- TÜBİTAK önerisindeki "HTML/CSS/JavaScript" ifadesinden sapma var (React ve TypeScript). Sonuç raporunda gerekçesiyle belirtilecek: bakım kolaylığı, test edilebilirlik, tip güvenliği.
- Öğrenme eğrisi: TypeScript ve React'e hâkim olmak gerekiyor, her fazın sonunda özet çıkarılarak desteklenecek.
