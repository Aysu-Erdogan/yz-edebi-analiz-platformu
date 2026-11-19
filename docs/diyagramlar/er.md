# Veri Modeli (ER Diyagramı)

Kaynak: [`Backend/prisma/schema.prisma`](../../Backend/prisma/schema.prisma). Şema değiştiğinde bu diyagram da güncellenir.

```mermaid
erDiagram
    PROVIDER_MODELS ||--o{ GENERATIONS : "çalıştırır"
    PROMPT_TEMPLATES ||--o{ GENERATIONS : "kullanılır"
    PROMPT_TEMPLATES ||--o{ EVALUATIONS : "yargıç prompt'u"
    EXPERIMENTS ||--o{ GENERATIONS : "gruplar"
    GENERATIONS ||--o| TEXTS : "üretir"
    TEXTS ||--o{ EVALUATIONS : "puanlanır"
    RUBRICS ||--o{ EVALUATIONS : "ölçüt olur"
    RUBRICS ||--|{ RUBRIC_CRITERIA : "içerir"
    RUBRIC_CRITERIA ||--|{ RUBRIC_LEVELS : "düzeyleri"
    EVALUATIONS ||--|{ EVALUATION_SCORES : "kriter puanları"

    PROVIDER_MODELS {
        int id PK
        string provider "openai | anthropic | google | mock"
        string model_id
        string display_name
        boolean active
        json default_params
    }
    PROMPT_TEMPLATES {
        int id PK
        enum kind "generate | judge"
        string version
        longtext body
    }
    RUBRICS {
        int id PK
        enum genre "siir | hikaye | deneme"
        string version
        enum status "draft | active | archived"
        int scale_min
        int scale_max
        text source_note
        datetime used_at "dolunca değiştirilemez"
    }
    RUBRIC_CRITERIA {
        int id PK
        int rubric_id FK
        string key
        string label
        text description
        float weight
        int sort_order
    }
    RUBRIC_LEVELS {
        int id PK
        int criterion_id FK
        int score
        text descriptor
    }
    EXPERIMENTS {
        int id PK
        string name
        json config
    }
    GENERATIONS {
        int id PK
        int provider_model_id FK
        int prompt_template_id FK
        int experiment_id FK
        enum genre
        string theme
        int replicate_no
        json params
        enum status "pending | running | succeeded | failed"
        text error
        int input_tokens
        int output_tokens
        int latency_ms
    }
    TEXTS {
        int id PK
        enum genre
        string theme
        longtext body
        enum source "generated | manual"
        string label
        int generation_id FK
    }
    EVALUATIONS {
        int id PK
        int text_id FK
        int rubric_id FK
        int prompt_template_id FK
        enum evaluator_type "llm | human"
        string evaluator_ref
        int replicate_no
        enum status "pending | running | succeeded | failed"
        text error
        float total_score
        json raw_response
    }
    EVALUATION_SCORES {
        int id PK
        int evaluation_id FK
        string criterion_key
        float score
        text comment
    }
    JOBS {
        int id PK
        string type
        json payload
        enum status
        int total
        int done
        int failed
        json result
        text error
        int attempts
    }
    USERS {
        int id PK
        string email UK
        string password_hash
        enum role "admin"
    }
```

## Önemli tasarım noktaları

- **Başarısızlık görünür:** `generations`, `evaluations` ve `jobs` kayıtları `status` ve `error` taşır. Uydurma puan yazılmaz ([ADR 0004](../adr/0004-sessiz-fallback-yok.md)).
- **Rubrik sürümlü ve kilitlenir:** `rubrics.used_at` dolduktan sonra rubrik değişmez, yeni sürüm açılır ([ADR 0003](../adr/0003-rubrik-veri-olarak.md)).
- **İnsan puanı için hazır:** `evaluations.evaluator_type = human` ile uzman puanları aynı tabloda tutulabilir. Etik kurul onayı gelene kadar bu yolla veri toplanmaz.
- **Tekrarlanabilirlik:** `generations.params`, model kaydı, prompt sürümü ve `replicate_no` bir üretimin yeniden kurulabilmesini sağlar.
