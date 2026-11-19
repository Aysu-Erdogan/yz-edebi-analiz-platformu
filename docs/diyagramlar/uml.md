# UML Diyagramları

Diyagramlar [Mermaid](https://mermaid.js.org/) ile yazılmıştır, GitHub'da doğrudan görünür. Bitirme raporu için PNG/PDF olarak dışa aktarılabilir (örn. <https://mermaid.live>).

> Durum notu: "Planlı" olarak işaretlenen bileşenler ilgili faz geldiğinde kodlanır (bkz. [IS_PLANI.md](../IS_PLANI.md)). Bu belge hedef tasarımı gösterir.

## 1. Kullanım durumu diyagramı

Mermaid'de standart kullanım durumu simgesi yoktur, aktör ve kullanım durumları akış şeması ile gösterilmiştir.

```mermaid
flowchart LR
    arastirmaci(["Araştırmacı / Kullanıcı"])
    yonetici(["Yönetici"])
    uzman(["Uzman (ileride)"])
    llm(["YZ Sağlayıcıları<br/>OpenAI · Anthropic · Google"])

    subgraph sistem ["YZ Edebi Analiz Platformu"]
        uc1("Metinleri karşılaştır")
        uc2("Metin üret")
        uc3("Metin kütüphanesini incele")
        uc4("Sonuçları ve istatistikleri gör")
        uc5("Veriyi dışa aktar")
        uc6("Rubriği görüntüle")
        uc7("Rubrik içe aktar / etkinleştir")
        uc8("Toplu üretim ve puanlama işi başlat")
        uc9("Uzman puanı gir")
    end

    arastirmaci --> uc1
    arastirmaci --> uc3
    arastirmaci --> uc4
    arastirmaci --> uc5
    arastirmaci --> uc6
    yonetici --> uc2
    yonetici --> uc7
    yonetici --> uc8
    uzman -.-> uc9
    uc1 --> llm
    uc2 --> llm
    uc8 --> llm
```

## 2. Dağıtım ve bileşen diyagramı

```mermaid
flowchart LR
    tarayici["Tarayıcı<br/>React arayüzü"]

    subgraph docker ["Docker Compose"]
        nginx["frontend<br/>nginx: statik dosyalar + /api vekili"]
        api["backend<br/>Express + TypeScript"]
        db[("db<br/>MySQL 8")]
    end

    subgraph dis ["Dış servisler"]
        openai["OpenAI API"]
        anthropic["Anthropic API"]
        google["Google Gemini API"]
    end

    tarayici -- "HTTP :8080" --> nginx
    nginx -- "/api/* → :3000" --> api
    api -- "Prisma / MySQL" --> db
    api -- "HTTPS" --> openai
    api -- "HTTPS" --> anthropic
    api -- "HTTPS" --> google
```

## 3. Sınıf diyagramı (backend çekirdeği, planlı: F1–F2)

```mermaid
classDiagram
    class LLMProvider {
        <<interface>>
        +id string
        +generateText(req) GenerateResult
        +generateJson(req) JsonResult
    }
    class OpenAIProvider
    class AnthropicProvider
    class GoogleProvider
    class MockProvider

    LLMProvider <|.. OpenAIProvider
    LLMProvider <|.. AnthropicProvider
    LLMProvider <|.. GoogleProvider
    LLMProvider <|.. MockProvider

    class ProviderRegistry {
        +get(modelRef) LLMProvider
        +list() ProviderModel[]
    }
    class RubricService {
        +import(json) Rubric
        +activate(id) void
        +validate(json) void
        +normalize(score, rubric) number
    }
    class GenerationService {
        +generate(request) Generation
    }
    class EvaluationService {
        +evaluate(textId, rubricId, judge) Evaluation
        -parseJudgeOutput(raw) Scores
        -weightedTotal(scores, rubric) number
    }
    class JobRunner {
        +enqueue(type, payload) Job
        +runNext() void
    }
    class StatsService {
        +describe(filter) Summary
        +compareGroups(filter) TestResult
    }

    ProviderRegistry --> LLMProvider
    GenerationService --> ProviderRegistry
    EvaluationService --> ProviderRegistry
    EvaluationService --> RubricService
    JobRunner --> GenerationService
    JobRunner --> EvaluationService
    StatsService ..> EvaluationService : sonuçları okur
```

## 4. Sıralama diyagramı: toplu üretim ve puanlama (planlı: F2)

```mermaid
sequenceDiagram
    actor Y as Yönetici
    participant UI as Arayüz
    participant API as Backend
    participant Q as JobRunner
    participant P as LLMProvider
    participant DB as MySQL

    Y->>UI: Modeller, türler, temalar seç ve başlat
    UI->>API: POST /generations
    API->>DB: Job kaydı (pending)
    API-->>UI: 202 + jobId
    loop Her kombinasyon için
        Q->>P: generateText(prompt)
        P-->>Q: metin, token, süre
        Q->>DB: Generation + Text (succeeded)
        Q->>P: generateJson(yargıç prompt'u, rubrik)
        P-->>Q: puanlar (JSON)
        alt Çıktı geçerli
            Q->>DB: Evaluation + puanlar (succeeded)
        else Geçersiz ve yeniden denemede de geçersiz
            Q->>DB: Evaluation (failed, neden)
        end
    end
    UI->>API: GET /jobs/:id (ilerleme)
    API-->>UI: done / failed / total
```

## 5. Durum diyagramı: üretim, değerlendirme ve iş durumları

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> running: işçi aldı
    running --> succeeded: geçerli sonuç
    running --> failed: hata ya da geçersiz çıktı
    failed --> pending: yeniden dene
    succeeded --> [*]
    failed --> [*]
```

## 6. Etkinlik diyagramı: bir metnin değerlendirilmesi

```mermaid
flowchart TD
    basla(["Başla"]) --> rubrik["Etkin rubriği al"]
    rubrik --> prompt["Kör yargıç prompt'unu kur<br/>(model adı yok, metin ayırıcılı)"]
    prompt --> cagri["Yargıç modeli çağır"]
    cagri --> hata{"Sağlayıcı hatası?"}
    hata -- "Evet (429/5xx)" --> tekrar["Geri çekilmeyle yeniden dene"]
    tekrar --> cagri
    hata -- "Hayır" --> dogrula{"zod doğrulaması geçti mi?<br/>(sayı, ölçek içinde, tüm kriterler)"}
    dogrula -- "Hayır" --> bir{"İlk deneme mi?"}
    bir -- "Evet" --> cagri
    bir -- "Hayır" --> basarisiz["Evaluation = failed + neden"]
    dogrula -- "Evet" --> toplam["Ağırlıklı toplam, 0-100'e normalleştir"]
    toplam --> kaydet["Evaluation = succeeded + puanlar"]
    kaydet --> bitir(["Bitir"])
    basarisiz --> bitir
```
