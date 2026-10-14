-- Schema de persistência do Excalidraw com contas e dados cifrados.
--
-- Aplicado automaticamente na inicialização do servidor (server/index.mjs),
-- então rodar este arquivo à mão só é necessário se você quiser preparar o
-- banco antes. Todas as instruções são idempotentes.
--
-- Regra do schema: as tabelas de conteúdo guardam *apenas* envelopes cifrados
-- no cliente. Não existe coluna com elementos, texto, mime type, nome de
-- arquivo ou qualquer id legível — ids de arquivo entram como índices cegos
-- (HMAC derivado da chave), que só servem para localizar a linha.

-- Contas -------------------------------------------------------------------
-- A conta é a chave de login. O servidor guarda somente o sha256 da credencial
-- derivada da frase: a frase em si e a chave de conteúdo nunca chegam aqui.
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` VARCHAR(64) NOT NULL,
  `auth_hash` CHAR(64) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- quando a chave de login foi entregue/confirmada pela primeira vez; a partir
  -- daí ela só é mostrada de novo por quem está logado
  `key_revealed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `accounts_auth_hash` (`auth_hash`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Cena ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `encrypted_scenes` (
  `account_id` VARCHAR(64) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `encrypted_scenes_account`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Biblioteca ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `encrypted_library` (
  `account_id` VARCHAR(64) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `encrypted_library_account`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Imagens ------------------------------------------------------------------
-- `file_key` é o índice cego do id real do arquivo (o id continua só no
-- navegador, dentro dos elementos da cena).
CREATE TABLE IF NOT EXISTS `encrypted_files` (
  `account_id` VARCHAR(64) NOT NULL,
  `file_key` VARCHAR(64) NOT NULL,
  `payload` LONGTEXT NOT NULL,
  PRIMARY KEY (`account_id`, `file_key`),
  CONSTRAINT `encrypted_files_account`
    FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_bin;

-- Tabelas antigas (cena única, em texto puro, sem contas) ------------------
-- Não têm mais uso: os dados agora vivem por conta e cifrados.
DROP TABLE IF EXISTS `scenes`;
DROP TABLE IF EXISTS `files`;
DROP TABLE IF EXISTS `library`;
