-- CreateTable
CREATE TABLE `provider_models` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(32) NOT NULL,
    `model_id` VARCHAR(128) NOT NULL,
    `display_name` VARCHAR(128) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `default_params` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `provider_models_provider_model_id_key`(`provider`, `model_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prompt_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('generate', 'judge') NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `prompt_templates_kind_version_key`(`kind`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rubrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `genre` ENUM('siir', 'hikaye', 'deneme') NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `status` ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
    `scale_min` INTEGER NOT NULL,
    `scale_max` INTEGER NOT NULL,
    `source_note` TEXT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rubrics_genre_status_idx`(`genre`, `status`),
    UNIQUE INDEX `rubrics_genre_version_key`(`genre`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rubric_criteria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rubric_id` INTEGER NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `description` TEXT NOT NULL,
    `weight` DOUBLE NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `rubric_criteria_rubric_id_key_key`(`rubric_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rubric_levels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `criterion_id` INTEGER NOT NULL,
    `score` INTEGER NOT NULL,
    `descriptor` TEXT NOT NULL,

    UNIQUE INDEX `rubric_levels_criterion_id_score_key`(`criterion_id`, `score`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `config` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `texts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `genre` ENUM('siir', 'hikaye', 'deneme') NOT NULL,
    `theme` VARCHAR(32) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `source` ENUM('generated', 'manual') NOT NULL,
    `label` VARCHAR(128) NULL,
    `generation_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `texts_generation_id_key`(`generation_id`),
    INDEX `texts_genre_theme_idx`(`genre`, `theme`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider_model_id` INTEGER NOT NULL,
    `prompt_template_id` INTEGER NOT NULL,
    `experiment_id` INTEGER NULL,
    `genre` ENUM('siir', 'hikaye', 'deneme') NOT NULL,
    `theme` VARCHAR(32) NOT NULL,
    `replicate_no` INTEGER NOT NULL DEFAULT 1,
    `params` JSON NOT NULL,
    `status` ENUM('pending', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
    `error` TEXT NULL,
    `input_tokens` INTEGER NULL,
    `output_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,

    INDEX `generations_experiment_id_idx`(`experiment_id`),
    INDEX `generations_genre_theme_idx`(`genre`, `theme`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `text_id` INTEGER NOT NULL,
    `rubric_id` INTEGER NOT NULL,
    `prompt_template_id` INTEGER NULL,
    `evaluator_type` ENUM('llm', 'human') NOT NULL,
    `evaluator_ref` VARCHAR(128) NOT NULL,
    `replicate_no` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('pending', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
    `error` TEXT NULL,
    `total_score` DOUBLE NULL,
    `raw_response` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `evaluations_text_id_idx`(`text_id`),
    INDEX `evaluations_rubric_id_idx`(`rubric_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_scores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evaluation_id` INTEGER NOT NULL,
    `criterion_key` VARCHAR(64) NOT NULL,
    `score` DOUBLE NOT NULL,
    `comment` TEXT NULL,

    UNIQUE INDEX `evaluation_scores_evaluation_id_criterion_key_key`(`evaluation_id`, `criterion_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(32) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
    `total` INTEGER NOT NULL DEFAULT 0,
    `done` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `result` JSON NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `jobs_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(190) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin') NOT NULL DEFAULT 'admin',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rubric_criteria` ADD CONSTRAINT `rubric_criteria_rubric_id_fkey` FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rubric_levels` ADD CONSTRAINT `rubric_levels_criterion_id_fkey` FOREIGN KEY (`criterion_id`) REFERENCES `rubric_criteria`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `texts` ADD CONSTRAINT `texts_generation_id_fkey` FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generations` ADD CONSTRAINT `generations_provider_model_id_fkey` FOREIGN KEY (`provider_model_id`) REFERENCES `provider_models`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generations` ADD CONSTRAINT `generations_prompt_template_id_fkey` FOREIGN KEY (`prompt_template_id`) REFERENCES `prompt_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `generations` ADD CONSTRAINT `generations_experiment_id_fkey` FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_text_id_fkey` FOREIGN KEY (`text_id`) REFERENCES `texts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_rubric_id_fkey` FOREIGN KEY (`rubric_id`) REFERENCES `rubrics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_prompt_template_id_fkey` FOREIGN KEY (`prompt_template_id`) REFERENCES `prompt_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_scores` ADD CONSTRAINT `evaluation_scores_evaluation_id_fkey` FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

