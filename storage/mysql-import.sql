-- MySQL import generated from SQLite app.db
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT PRIMARY KEY,
  `odoo_base_url` TEXT NOT NULL,
  `odoo_database` TEXT NOT NULL,
  `odoo_username` TEXT NOT NULL,
  `odoo_api_key_encrypted` TEXT NOT NULL,
  `field_mapping_json` LONGTEXT NOT NULL,
  `parser_config_json` LONGTEXT NOT NULL,
  `scheduler_config_json` LONGTEXT NOT NULL,
  `stock_config_json` LONGTEXT NOT NULL,
  `connection_status` VARCHAR(32) NOT NULL DEFAULT 'not_configured',
  `connection_checked_at` DATETIME NULL,
  `connection_message` TEXT NULL,
  `connection_version` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `logs` (
  `id` VARCHAR(64) PRIMARY KEY,
  `history_id` VARCHAR(64) NULL,
  `level` VARCHAR(16) NOT NULL,
  `message` TEXT NOT NULL,
  `context_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `history` (
  `id` VARCHAR(64) PRIMARY KEY,
  `order_id` INT NOT NULL,
  `order_name` TEXT NOT NULL,
  `attachment_id` INT NOT NULL,
  `attachment_name` TEXT NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  `summary` TEXT NULL,
  `error_message` TEXT NULL,
  `extracted_result_id` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `computed_signature` TEXT NULL,
  `stored_signature` TEXT NULL,
  `signature_comparison` VARCHAR(32) NULL,
  `send_skipped` TINYINT(1) NOT NULL DEFAULT 0,
  `signature_written` TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `extracted_results` (
  `id` VARCHAR(64) PRIMARY KEY,
  `history_id` VARCHAR(64) NOT NULL,
  `order_id` INT NOT NULL,
  `order_name` TEXT NOT NULL,
  `attachment_id` INT NOT NULL,
  `attachment_name` TEXT NOT NULL,
  `result_json` LONGTEXT NOT NULL,
  `raw_text` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `pdf_signature` TEXT NULL
);

CREATE TABLE IF NOT EXISTS `odoo_model_fields_cache` (
  `model_name` VARCHAR(191) PRIMARY KEY,
  `fields_json` LONGTEXT NOT NULL,
  `fetched_at` DATETIME NULL
);

CREATE TABLE IF NOT EXISTS `scheduler_runs` (
  `id` VARCHAR(64) PRIMARY KEY,
  `status` VARCHAR(64) NOT NULL,
  `trigger_source` VARCHAR(32) NOT NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME NULL,
  `scanned_count` INT NOT NULL DEFAULT 0,
  `processed_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `summary` TEXT NULL,
  `error_message` TEXT NULL,
  `context_json` LONGTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `scheduler_runtime_state` (
  `id` INT PRIMARY KEY,
  `lock_run_id` VARCHAR(64) NULL,
  `lock_acquired_at` DATETIME NULL,
  `last_successful_run_id` VARCHAR(64) NULL,
  `last_successful_finished_at` DATETIME NULL,
  `last_checkpoint_at` DATETIME NULL,
  `last_error_run_id` VARCHAR(64) NULL,
  `last_error_message` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `stock_processed_items` (
  `id` VARCHAR(64) PRIMARY KEY,
  `order_id` INT NOT NULL,
  `extraction_signature` VARCHAR(255) NOT NULL,
  `variant_id` INT NOT NULL,
  `normalized_color` VARCHAR(255) NOT NULL DEFAULT '',
  `quantity_added_meters` INT NOT NULL DEFAULT 0,
  `history_id` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `stock_processing_locks` (
  `lock_key` VARCHAR(255) PRIMARY KEY,
  `order_id` INT NOT NULL,
  `extraction_signature` VARCHAR(255) NOT NULL,
  `acquired_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `stock_reversed_items` (
  `processed_item_id` VARCHAR(64) PRIMARY KEY,
  `order_id` INT NOT NULL,
  `reversed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `auth_login_challenges` (
  `id` VARCHAR(64) PRIMARY KEY,
  `email` VARCHAR(255) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `redirect_path` VARCHAR(1024) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `attempts_remaining` INT NOT NULL DEFAULT 5,
  `consumed_at` DATETIME NULL,
  `requested_ip` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` VARCHAR(64) PRIMARY KEY,
  `email` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'user',
  `csrf_token` VARCHAR(255) NOT NULL,
  `user_agent_hash` VARCHAR(255) NOT NULL DEFAULT '',
  `ip_address` VARCHAR(255) NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `auth_attempts` (
  `id` VARCHAR(64) PRIMARY KEY,
  `scope` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NULL,
  `ip_address` VARCHAR(255) NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `auth_approved_users` (
  `email` VARCHAR(255) PRIMARY KEY,
  `role` VARCHAR(32) NOT NULL DEFAULT 'user',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DELETE FROM `settings`;
INSERT INTO `settings` (`id`, `odoo_base_url`, `odoo_database`, `odoo_username`, `odoo_api_key_encrypted`, `field_mapping_json`, `parser_config_json`, `connection_status`, `connection_checked_at`, `connection_message`, `connection_version`, `updated_at`, `scheduler_config_json`, `stock_config_json`) VALUES (1, 'https://www.urbanvibeinteriordesign.co.ke', 'urban-vibe-interior-design', 'dbadmin@urbanvibeinteriordesign.co.ke', 'JvUhFPVPV4S1Py91:ue9+eIZkTRjHdWRN56/DNg==:Io+VxT/l7xc/enc9KB+LIEBt3Jki2xuLL7kipUtdUGlLU7w4GDUFsg==', '{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"x_studio_job_summary_stock_processed","stockSignatureField":"x_studio_job_summary_stock_signature","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"}', '{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."}', 'success', '2026-04-25 01:40:47', 'Connected as Leoivard Ongule.', '19.0+e', '2026-04-25 01:44:10', '{"enabled":true,"intervalMinutes":15,"batchSize":15,"confirmedFromDate":"2026-04-08 00:00:00","cronToken":"","useInProcessInterval":false}', '{"locationId":"8","locationName":"WH/Stock","warehouseId":"1","pickingTypeId":""}');

DELETE FROM `logs`;
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('757930b9-7081-46ba-b80a-ddb82d638cd0', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-17 12:09:57');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1c792b00-c2ab-45bd-ac1e-3e9523278e83', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-17 14:01:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('33aa87b2-ce9a-45ef-8f5e-7449728b80dc', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-17 14:55:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('57c14b9b-9000-4dd2-8d37-df6fdd7e835d', NULL, 'info', 'Setup settings saved', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","database":"urban-vibe-interior-design","username":"dbadmin@urbanvibeinteriordesign.co.ke"}', '2026-04-17 14:58:15');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8aa7bfb1-1017-4945-a4c2-a4d2d4410eb5', NULL, 'info', 'Odoo connection test succeeded', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-17 14:58:23');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ae412619-55fb-4d3b-9f0f-126ecc10da9c', '5176a0b0-fb2b-42d6-ab21-b8bdb63954b5', 'info', 'Extraction started', '{"orderId":2230,"orderName":"S02182","attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf"}', '2026-04-17 15:02:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('51e8b8d6-1bcc-4091-a1ef-cef5849c5cfb', '5176a0b0-fb2b-42d6-ab21-b8bdb63954b5', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","fileSize":78837}', '2026-04-17 15:02:43');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2e00e12d-7a34-4471-990d-6463fdc7e236', '5176a0b0-fb2b-42d6-ab21-b8bdb63954b5', 'info', 'PDF parsing completed', '{"historyId":"5176a0b0-fb2b-42d6-ab21-b8bdb63954b5","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '2026-04-17 15:02:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('814eb8e0-46ab-4dcb-a159-203f397e9eb8', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-17 16:00:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8dc0d7db-db98-413b-9b7e-fa664bdac474', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 19:40:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b91e02a2-0edf-4d9a-be70-be005e8f5777', NULL, 'info', 'Odoo connection test succeeded', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-19 19:42:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('12088e25-73a8-43da-b175-9d8460a60399', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 20:51:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d1228f82-b176-4bfb-823b-0fca1572dc4d', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-19 20:53:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('441b6169-91f5-4e9d-9c72-f1dbd7a481a9', '6829564b-0a9c-41aa-b585-5c90de4337f0', 'info', 'Extraction started', '{"orderId":2230,"orderName":"S02182","attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf"}', '2026-04-19 21:12:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ccaff190-c4f2-4437-acf1-6e791701dee5', '6829564b-0a9c-41aa-b585-5c90de4337f0', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","fileSize":78837}', '2026-04-19 21:12:13');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('517a3947-4c3a-4074-8871-be17a9b4c619', '6829564b-0a9c-41aa-b585-5c90de4337f0', 'info', 'PDF parsing completed', '{"historyId":"6829564b-0a9c-41aa-b585-5c90de4337f0","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '2026-04-19 21:12:14');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5e72f96e-e84c-4f60-b7f5-ae0c00b2b177', '6829564b-0a9c-41aa-b585-5c90de4337f0', 'info', 'Structured data sent to Odoo', '{"historyId":"6829564b-0a9c-41aa-b585-5c90de4337f0","orderId":2230,"fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_last_job_summary_attachment_id_1"],"skippedFields":[],"missingMappings":["Processed Date Field","Attachment Name Field"]}', '2026-04-19 21:12:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0278669a-b2dc-4af4-ab65-12f9dac55ce5', '6829564b-0a9c-41aa-b585-5c90de4337f0', 'warn', 'Some sale.order fields were skipped before writing to Odoo', '{"historyId":"6829564b-0a9c-41aa-b585-5c90de4337f0","orderId":2230,"skippedFields":[],"missingMappings":["Processed Date Field","Attachment Name Field"]}', '2026-04-19 21:12:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2e8eeb2a-3c94-42d8-8666-93d9624e7f5c', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-19 21:18:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('979d88cf-212d-47b8-a8a2-24d85a0e730f', 'd9887058-7396-41fc-8c8c-0d8a0602e01b', 'info', 'Extraction started', '{"orderId":2230,"orderName":"S02182","attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf"}', '2026-04-19 21:19:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ef54d238-b34a-43bc-9967-f5a060afe21f', 'd9887058-7396-41fc-8c8c-0d8a0602e01b', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","fileSize":78837}', '2026-04-19 21:19:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1337ad51-5379-46eb-9932-affa93a7c8d3', 'd9887058-7396-41fc-8c8c-0d8a0602e01b', 'info', 'PDF parsing completed', '{"historyId":"d9887058-7396-41fc-8c8c-0d8a0602e01b","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '2026-04-19 21:19:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('84016182-3b8e-498a-8dea-f6685b90effb', 'd9887058-7396-41fc-8c8c-0d8a0602e01b', 'info', 'Structured data sent to Odoo', '{"historyId":"d9887058-7396-41fc-8c8c-0d8a0602e01b","orderId":2230,"fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1"],"skippedFields":[],"missingMappings":[]}', '2026-04-19 21:19:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('39def884-fb34-4b22-b829-bf6b716b3498', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-19 21:53:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b8cacf50-67c6-403b-8599-937643cd7c4f', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 'info', 'Extraction started', '{"orderId":2230,"orderName":"S02182","attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf"}', '2026-04-19 21:55:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d39233f4-fe2f-4b31-9452-3c7a34e7291a', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","fileSize":78837}', '2026-04-19 21:55:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4315731c-bdd0-46d7-9465-482a0a121bd0', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 'info', 'PDF parsing completed', '{"historyId":"2ec32b6a-1d29-45c4-a0cc-34e54dda5505","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '2026-04-19 21:55:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('358cb02d-fad5-448c-9b2d-8e8d37e5e31a', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 21:56:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('671268e5-32e9-4cba-ada7-a9a4f506bbd5', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 'info', 'Structured data sent to Odoo', '{"historyId":"2ec32b6a-1d29-45c4-a0cc-34e54dda5505","orderId":2230,"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1"],"skippedFields":[],"missingMappings":[],"computedSignature":null,"storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":false}', '2026-04-19 21:57:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2f4b9978-4f08-4e66-8108-243db706324d', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 'info', 'Signature compared against Odoo', '{"historyId":"2ec32b6a-1d29-45c4-a0cc-34e54dda5505","orderId":2230,"attachmentId":8002,"attachmentName":"Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf","computedSignature":null,"storedOdooSignature":null,"comparisonResult":"missing","signatureField":"x_studio_job_summary_signature"}', '2026-04-19 21:59:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('286dc0f1-fe1e-431b-9e2d-e1175e140fe9', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 22:04:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('df8d4100-fc33-431d-9f35-cd70c74aac0d', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 22:10:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('63449953-18eb-47a6-97f2-86002591bb69', '35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 'info', 'Extraction started', '{"orderId":2271,"orderName":"S02223","attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf"}', '2026-04-19 22:10:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('06392b89-d825-4412-8b2b-e51842b369c3', '35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","fileSize":78014,"computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:10:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4d4774d7-8ccf-4961-9924-269bd54f5a47', '35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 'info', 'PDF parsing completed', '{"historyId":"35b6a34d-8d76-4e5c-aa32-f34f022d40ed","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:10:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0e3bc574-cf27-4ff5-bbcc-a03c8a1001d4', '35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 'info', 'Structured data sent to Odoo', '{"historyId":"35b6a34d-8d76-4e5c-aa32-f34f022d40ed","orderId":2271,"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-19 22:10:55');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ebb9265c-7ea0-4181-aab4-70c404319102', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 22:19:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2b9e79fc-3720-4ecd-8b47-08366b8aaf69', 'dde3c954-805f-4b63-be2e-81667da4ee93', 'info', 'Extraction started', '{"orderId":2250,"orderName":"S02202","attachmentId":8131,"attachmentName":"Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf"}', '2026-04-19 22:21:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b2dfc1e9-a05c-4d66-8611-194cc1898b9e', 'dde3c954-805f-4b63-be2e-81667da4ee93', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8131,"attachmentName":"Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf","fileSize":79862,"computedSignature":"af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:21:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a56c30ba-5d3c-4c30-b7a2-48fac641a4e3', 'dde3c954-805f-4b63-be2e-81667da4ee93', 'info', 'PDF parsing completed', '{"historyId":"dde3c954-805f-4b63-be2e-81667da4ee93","itemsExtracted":2,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Royal teak 1mm\\".","Detected edging entry \\"White 1mm\\".","Extracted 2 edging material item(s)."],"attachmentId":8131,"attachmentName":"Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf","computedSignature":"af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:21:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d03205b0-95da-4f08-97d5-2313a04ebaff', 'dde3c954-805f-4b63-be2e-81667da4ee93', 'info', 'Structured data sent to Odoo', '{"historyId":"dde3c954-805f-4b63-be2e-81667da4ee93","orderId":2250,"attachmentId":8131,"attachmentName":"Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-19 22:21:29');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d56cbbac-5497-479d-ab38-a8dbd0e63380', '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 'info', 'Extraction started', '{"orderId":2263,"orderName":"S02215","attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf"}', '2026-04-19 22:21:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f8dd2d0c-db3a-4f4d-9dc1-8dc18672f3e0', '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","fileSize":77906,"computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:21:47');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('47137770-bcbd-4ab5-94e9-43fa811d6f7d', '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 'info', 'PDF parsing completed', '{"historyId":"1c55bda9-9812-4bc1-afc8-1a7f32a80b26","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Cappuccino 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:21:47');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('56cafae7-3ff9-4aa6-9c91-f364a0f7237f', '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 'info', 'Structured data sent to Odoo', '{"historyId":"1c55bda9-9812-4bc1-afc8-1a7f32a80b26","orderId":2263,"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-19 22:22:03');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4e9c9de2-2a57-4cec-855a-e6e17aa9e0e6', 'e044ccaf-c171-4768-a2a6-2c02e0198ff5', 'info', 'Extraction started', '{"orderId":2261,"orderName":"S02213","attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf"}', '2026-04-19 22:22:30');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b165cc5e-a57d-465e-94ea-759fd9a25e9d', 'e044ccaf-c171-4768-a2a6-2c02e0198ff5', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","fileSize":77977,"computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:22:32');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f429d6f5-8e4b-4f5a-92aa-16d0790cdd34', 'e044ccaf-c171-4768-a2a6-2c02e0198ff5', 'info', 'PDF parsing completed', '{"historyId":"e044ccaf-c171-4768-a2a6-2c02e0198ff5","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:22:32');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3364b687-3e0f-4a79-b165-21f9c89b0a0a', 'e044ccaf-c171-4768-a2a6-2c02e0198ff5', 'info', 'Structured data sent to Odoo', '{"historyId":"e044ccaf-c171-4768-a2a6-2c02e0198ff5","orderId":2261,"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-19 22:22:53');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('76b5a65b-1273-46a2-ac97-84506c205d16', '9582769e-8ea6-4c5e-8397-4b5349f96209', 'info', 'Extraction started', '{"orderId":2260,"orderName":"S02212","attachmentId":8124,"attachmentName":"Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf"}', '2026-04-19 22:40:37');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3fca7e5c-d9ed-4ca6-9430-191a4551811e', '9582769e-8ea6-4c5e-8397-4b5349f96209', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8124,"attachmentName":"Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf","fileSize":78456,"computedSignature":"144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:40:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5a30acbf-022b-4372-96c5-f039dd79f874', '9582769e-8ea6-4c5e-8397-4b5349f96209', 'info', 'PDF parsing completed', '{"historyId":"9582769e-8ea6-4c5e-8397-4b5349f96209","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8124,"attachmentName":"Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf","computedSignature":"144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-19 22:40:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3b06dced-b06f-42d5-b88d-014cabd70cc8', '9582769e-8ea6-4c5e-8397-4b5349f96209', 'info', 'Structured data sent to Odoo', '{"historyId":"9582769e-8ea6-4c5e-8397-4b5349f96209","orderId":2260,"attachmentId":8124,"attachmentName":"Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-19 22:41:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3e3271fe-6f78-47e4-960e-ea1686fe883b', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-19 23:56:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6eb52f94-5048-4d2a-b20a-5eae48a67a3f', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-20 00:09:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6503e862-8219-4349-8d2f-77fbe0e8fde2', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-20 00:14:30');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8fae9464-d676-4921-bf10-207a74881f3b', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-20 00:17:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3534e802-fabc-42e0-b13c-f7d8b9e50c4c', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-20 00:17:48');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ecde1f37-0f1c-47b4-bb4e-e594387ad1d5', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-20 00:31:04');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('af8c213b-a6f1-4a16-b628-6e6797801473', 'e75c06c3-7f3d-4421-a784-3b35100d8e5f', 'info', 'Extraction started', '{"orderId":2271,"orderName":"S02223","attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf"}', '2026-04-20 00:36:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('dbf8359c-8a9e-46e8-b083-ca9838d85005', 'e75c06c3-7f3d-4421-a784-3b35100d8e5f', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","fileSize":78014,"computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","signatureComparison":"match"}', '2026-04-20 00:36:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a5593d0f-e43c-4132-b7cc-e31c7c06db99', 'e75c06c3-7f3d-4421-a784-3b35100d8e5f', 'info', 'PDF parsing completed', '{"historyId":"e75c06c3-7f3d-4421-a784-3b35100d8e5f","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","signatureComparison":"match"}', '2026-04-20 00:36:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f8d7a814-8283-42e1-a3a1-fd66b5a4ac8a', 'e75c06c3-7f3d-4421-a784-3b35100d8e5f', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"e75c06c3-7f3d-4421-a784-3b35100d8e5f","orderId":2271,"attachmentId":8154,"attachmentName":"Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf","computedSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","storedOdooSignature":"5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-20 00:36:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('aa6b53cb-0ad9-4b01-8d10-e77c60736b25', '9d13dad5-4414-47d0-9ba8-47d66bba4630', 'info', 'Extraction started', '{"orderId":2219,"orderName":"S02171","attachmentId":7961,"attachmentName":"Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf"}', '2026-04-20 00:39:07');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('01826b99-a43f-44f6-88bf-08f891b0f62f', '9d13dad5-4414-47d0-9ba8-47d66bba4630', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":7961,"attachmentName":"Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf","fileSize":78751,"computedSignature":"7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:39:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3ef12cab-ca26-44f6-a190-445c49c409f3', '9d13dad5-4414-47d0-9ba8-47d66bba4630', 'info', 'PDF parsing completed', '{"historyId":"9d13dad5-4414-47d0-9ba8-47d66bba4630","itemsExtracted":2,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Darkwalnut 1mm\\".","Detected edging entry \\"White 1mm\\".","Extracted 2 edging material item(s)."],"attachmentId":7961,"attachmentName":"Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf","computedSignature":"7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:39:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('75391b4b-c1eb-476e-9f6c-65d945173518', '9d13dad5-4414-47d0-9ba8-47d66bba4630', 'info', 'Structured data sent to Odoo', '{"historyId":"9d13dad5-4414-47d0-9ba8-47d66bba4630","orderId":2219,"attachmentId":7961,"attachmentName":"Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-20 00:39:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('eca1c39c-b9de-475e-a442-485cbcfbb2fc', 'c51b397a-b644-46dc-9186-c65d98a68011', 'info', 'Extraction started', '{"orderId":2220,"orderName":"S02172","attachmentId":7963,"attachmentName":"Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf"}', '2026-04-20 00:42:47');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fbf93d9d-5cab-44bd-89ae-43e08875cd57', 'c51b397a-b644-46dc-9186-c65d98a68011', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":7963,"attachmentName":"Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf","fileSize":78461,"computedSignature":"58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:42:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('acbd57fe-5966-4cd7-85f9-45211052bc07', 'c51b397a-b644-46dc-9186-c65d98a68011', 'info', 'PDF parsing completed', '{"historyId":"c51b397a-b644-46dc-9186-c65d98a68011","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":7963,"attachmentName":"Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf","computedSignature":"58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:42:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6e2e8500-fde2-4ae2-ba9e-d31521e0c6b3', 'c51b397a-b644-46dc-9186-c65d98a68011', 'info', 'Structured data sent to Odoo', '{"historyId":"c51b397a-b644-46dc-9186-c65d98a68011","orderId":2220,"attachmentId":7963,"attachmentName":"Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-20 00:43:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d37dd16f-547f-4a46-ad9a-da2feffe2be2', '332b77ee-c992-4b03-807f-5d87ae8e9aa8', 'info', 'Extraction started', '{"orderId":1028,"orderName":"S01028","attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf"}', '2026-04-20 00:43:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c136bb5a-2856-4051-808a-b820e196d828', '332b77ee-c992-4b03-807f-5d87ae8e9aa8', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf","fileSize":78361,"computedSignature":"70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:43:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('13e717ba-da44-42c9-9069-26b9f26800d0', '332b77ee-c992-4b03-807f-5d87ae8e9aa8', 'info', 'PDF parsing completed', '{"historyId":"332b77ee-c992-4b03-807f-5d87ae8e9aa8","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Harbour Grey 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf","computedSignature":"70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:43:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('40d5c064-a9b2-45ff-828e-108fb2b6b74f', '01cda4bb-6318-43be-9f2f-5e5a98278b5d', 'info', 'Extraction started', '{"orderId":1028,"orderName":"S01028","attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf"}', '2026-04-20 00:55:32');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8355383f-67b7-41eb-b531-fad8422233a0', '01cda4bb-6318-43be-9f2f-5e5a98278b5d', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf","fileSize":78361,"computedSignature":"70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:55:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a27c58e2-fefe-4e8b-9185-c3940efb962c', '01cda4bb-6318-43be-9f2f-5e5a98278b5d', 'info', 'PDF parsing completed', '{"historyId":"01cda4bb-6318-43be-9f2f-5e5a98278b5d","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Harbour Grey 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf","computedSignature":"70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 00:55:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0a6cefe8-a0e5-4b19-97fe-c28990bfe739', '01cda4bb-6318-43be-9f2f-5e5a98278b5d', 'info', 'Structured data sent to Odoo', '{"historyId":"01cda4bb-6318-43be-9f2f-5e5a98278b5d","orderId":1028,"attachmentId":8147,"attachmentName":"Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-20 00:55:58');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1b93611e-3709-4d03-a938-d8de43c51895', 'dde3c954-805f-4b63-be2e-81667da4ee93', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"dde3c954-805f-4b63-be2e-81667da4ee93","orderId":2250,"attachmentId":8131,"attachmentName":"Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf","computedSignature":"af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4","storedOdooSignature":"af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-20 03:51:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('957dfcb8-c02b-4e04-b701-96e80fa0cf37', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-20 04:02:13');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('facba734-f637-42a6-9de1-0ed26ac760c6', '698a95b6-ae57-4bda-a747-643e345ea2e0', 'info', 'Extraction started', '{"orderId":2257,"orderName":"S02209","attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf"}', '2026-04-20 04:03:23');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b9401129-b90c-4162-8d7f-011fa055068e', '698a95b6-ae57-4bda-a747-643e345ea2e0', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","fileSize":78722,"computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 04:03:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5757b63e-ec2d-4fb8-9854-6a74d94d6a00', '698a95b6-ae57-4bda-a747-643e345ea2e0', 'info', 'PDF parsing completed', '{"historyId":"698a95b6-ae57-4bda-a747-643e345ea2e0","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Esperanza 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-20 04:03:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d0dfe58f-d9a9-459e-9f9b-3f588f40e7ce', '698a95b6-ae57-4bda-a747-643e345ea2e0', 'info', 'Structured data sent to Odoo', '{"historyId":"698a95b6-ae57-4bda-a747-643e345ea2e0","orderId":2257,"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-20 04:03:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6e22107e-eed2-4ea4-9e67-5504ba925d74', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-21 23:28:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('de396e17-1b4b-44b1-aaf7-66db45a8d5bc', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-21 23:29:55');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('aa1e3cac-5b23-4945-8ff6-265ba7dd29df', '42e1473b-90a1-4e97-842c-ddc6eddd2b38', 'info', 'Extraction started', '{"orderId":1016,"orderName":"S01016","attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf"}', '2026-04-21 23:30:23');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d6b3abb4-d55a-4902-9da4-752e4092ccec', '42e1473b-90a1-4e97-842c-ddc6eddd2b38', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","fileSize":78718,"computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-21 23:30:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('24c03da2-adfa-4c05-a29a-7249459e9804', '42e1473b-90a1-4e97-842c-ddc6eddd2b38', 'info', 'PDF parsing completed', '{"historyId":"42e1473b-90a1-4e97-842c-ddc6eddd2b38","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Light grey 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-21 23:30:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('32d0fc66-1d1f-43e8-9a73-a29d8b6bfd19', '42e1473b-90a1-4e97-842c-ddc6eddd2b38', 'info', 'Structured data sent to Odoo', '{"historyId":"42e1473b-90a1-4e97-842c-ddc6eddd2b38","orderId":1016,"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-21 23:30:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('dd1e3794-62c3-4327-8ad9-3933fcf22052', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-22 21:29:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f9d5d4cf-e865-459e-945a-b798f5d253cc', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 12:55:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('145b3e05-bf10-40f2-ba67-50e8d3b1e5eb', 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-23 12:57:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bb06dc2c-967d-470a-8147-a2eeb834d3fc', 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-23 12:57:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('04903d88-139b-4191-9e92-3702e2dc998f', 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 'info', 'PDF parsing completed', '{"historyId":"b6a2c08a-9429-4aad-96af-8ddfd11d76fc","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-23 12:57:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d8c98c5b-5d1c-4446-923d-58478d078691', 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 'info', 'Structured data sent to Odoo', '{"historyId":"b6a2c08a-9429-4aad-96af-8ddfd11d76fc","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-23 12:57:43');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fa0f746e-0985-4a3e-b296-522ef59f8e52', NULL, 'error', 'Stock processing failed', '{"orderId":2296,"signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"error":"Stock location is not configured."}', '2026-04-23 12:58:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5ba6f688-0a3d-4f64-9476-9c48a8e87b4b', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-23 12:59:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bf5c3c27-70f3-4974-b689-a28290ba7321', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 12:59:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fbc58b22-e10b-42d2-81f2-7afa357b03a7', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 13:18:18');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('63c3dec4-20cc-4894-b59d-a98142829e74', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:18:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('84adfb69-3432-4e7f-86e9-538e87d8cdd4', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:19:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('57b527f1-1f9c-45cf-98f8-8cc8e713c98c', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-23 13:20:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1c0d5081-ad6b-404b-b1f0-2673d71b9368', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:20:57');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2dec078e-953b-46a6-8c20-ba6500d5a184', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:22:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('819d3bcc-bdad-4113-a042-5084635b6003', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:23:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7b12714b-13e9-41c8-b68c-97d3522c196c', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 13:47:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('147daf60-b852-4045-8606-0f197d0858d8', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":1,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 14:03:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4c89de2a-448d-4611-aa62-5f073bbc9208', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":1,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 14:25:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('833a72d0-9a72-4501-8e3a-41426c997124', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":1,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 14:25:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2ba31dc4-066d-445c-ab19-69d546c80b2e', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":1,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 14:34:11');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f6b7a409-518b-422f-bfd7-271bc0ca8adc', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 14:35:57');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0ae4b754-580d-48d4-a480-a290b8ca4305', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 14:36:14');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ece27fa4-3adb-46cb-8865-13766115215b', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 15:08:29');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7b2e5c0f-4111-4bfd-a438-9c48010151b6', 'c52ea6a3-4127-4eb7-825f-8a866562bd16', 'info', 'Extraction started', '{"orderId":2291,"orderName":"S02243","attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf"}', '2026-04-23 15:10:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('99802305-ef60-423b-8df3-955258f04117', 'c52ea6a3-4127-4eb7-825f-8a866562bd16', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","fileSize":78027,"computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-23 15:10:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1c306b4d-f4be-47d0-a7fe-be591fe4ba80', 'c52ea6a3-4127-4eb7-825f-8a866562bd16', 'info', 'PDF parsing completed', '{"historyId":"c52ea6a3-4127-4eb7-825f-8a866562bd16","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-23 15:10:03');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7f556b45-12b1-452c-a37b-9bf0d20b2bb8', 'c52ea6a3-4127-4eb7-825f-8a866562bd16', 'info', 'Structured data sent to Odoo', '{"historyId":"c52ea6a3-4127-4eb7-825f-8a866562bd16","orderId":2291,"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-23 15:10:21');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1a23ef37-e937-4de6-a667-b86cd0cfbf70', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:11:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3ca7f4d2-d84f-4dbd-85b0-465441c35bac', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:12:06');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fc434638-9ad3-4a5d-9cbd-543288b90256', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:12:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6b2361d9-4e19-49ba-8e69-b9670992bcb3', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:13:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3281dcd5-c3cb-4557-8f3c-fb5cf39c1e5b', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 15:31:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8d5e1d66-bbcf-4474-8f49-96f68774278b', NULL, 'error', 'Stock processing failed', '{"orderId":2291,"signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"error":"Domain() malformed domain [[\'active\', \'=\', True], \'|\', [\'company_id\', \'=\', False], [\'company_id\', \'=\', 1], \'|\', \'|\', [\'product_id\', \'=\', 115], [\'product_tmpl_id\', \'=\', 70]]"}', '2026-04-23 15:34:37');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a8746492-0da2-49af-8a2c-a34be4a27aea', NULL, 'error', 'Stock processing failed', '{"orderId":2291,"signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"error":"Domain() malformed domain [[\'active\', \'=\', True], \'|\', [\'company_id\', \'=\', False], [\'company_id\', \'=\', 1], \'|\', \'|\', [\'product_id\', \'=\', 115], [\'product_tmpl_id\', \'=\', 70]]"}', '2026-04-23 15:35:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0241750f-48c8-46b1-b76e-5c2495aa9590', NULL, 'error', 'Stock processing failed', '{"orderId":2291,"signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"error":"Domain() malformed domain [[\'active\', \'=\', True], \'|\', [\'company_id\', \'=\', False], [\'company_id\', \'=\', 1], \'|\', \'|\', [\'product_id\', \'=\', 115], [\'product_tmpl_id\', \'=\', 70]]"}', '2026-04-23 15:36:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d84975f3-0213-4fcc-aa19-03ab686ba7ec', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 15:42:55');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9d9531c7-5396-4579-911e-e77361338f16', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:43:58');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4a6f22d5-6926-4d50-adc9-63d21bc71e68', NULL, 'info', 'Stock processing completed', '{"orderId":1016,"orderName":"S01016","signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:47:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('63bebfd9-dc34-4f48-ad5d-01c4876c1914', '8e055e9d-ba32-48ae-80b9-36693470612b', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-23 15:49:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3a9569d9-91fa-48a0-a415-4190143d3aaf', '8e055e9d-ba32-48ae-80b9-36693470612b', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 15:49:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('dba95dc5-a78b-47f1-a766-cd1c9a188360', '8e055e9d-ba32-48ae-80b9-36693470612b', 'info', 'PDF parsing completed', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Detected edging entry \\"Esperanza 1mm\\".","Detected edging entry \\"Neuro 1mm\\".","Detected edging entry \\"White 1mm\\".","Detected edging entry \\"White Marble 1mm\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 15:49:57');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2e7ea1d2-c15f-4622-b046-a5aca8538cad', '8e055e9d-ba32-48ae-80b9-36693470612b', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-23 15:50:07');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c00d6024-7684-407d-8d41-e6295cba834d', NULL, 'error', 'Stock processing failed', '{"orderId":2266,"signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"error":"unhashable type: \'list\'"}', '2026-04-23 15:50:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f4992baa-a7a9-483f-a86a-e1dbf1c4b4ac', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":2,"failedCount":1,"missingSoItemsCount":0,"missingComponentCount":1,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 15:51:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9026cde3-a5f9-44fd-9247-1ae70b26b6d5', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 16:28:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4feb381e-e44f-4a47-a20d-d9dc0ad98284', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":1,"skippedCount":5,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 16:28:37');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f2a02b50-7fe5-46b4-bab5-9188380f424a', NULL, 'info', 'Stock processing completed', '{"orderId":2263,"orderName":"S02215","signature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 16:32:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f2b6e06e-de6a-40c5-981f-b3925c59e463', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 17:04:14');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9a74c8e5-f1a3-4c47-9495-3aaa5330f86e', NULL, 'warn', 'Stock additions reversed', '{"orderId":2263,"reversedCount":1,"affectedVariants":1,"itemIds":["f6f52fa2-25d4-4a7d-9407-c714481703e9"]}', '2026-04-23 17:08:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bb0d7036-35f2-4d33-9459-e52fc1838632', NULL, 'warn', 'Stock additions reversed', '{"orderId":2266,"reversedCount":1,"affectedVariants":1,"itemIds":["99549cb5-ff0b-497c-a545-27edc4bf12cd"]}', '2026-04-23 17:45:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5a7862fe-90eb-40c8-b5f0-a91021d03931', NULL, 'warn', 'Stock additions reversed', '{"orderId":1016,"reversedCount":1,"affectedVariants":1,"itemIds":["9cd6dc7b-00f3-480f-a0fa-d9f33536b466"]}', '2026-04-23 17:55:44');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1a469e29-efae-4b24-8c02-04f5158c4ed2', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 17:58:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5d8a0dc6-30a3-45b6-9c03-58a10ab812fe', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 18:01:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('62b6b751-bee6-41da-ae9c-ae3e29f67441', NULL, 'info', 'Stock processing completed', '{"orderId":1016,"orderName":"S01016","signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 18:07:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('99f479a2-076e-498d-9197-6f459241b91e', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 19:14:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9fbf2904-5223-4ba6-bc8e-7ef4b419aa95', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 19:23:58');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('232378fc-4fde-406a-86db-a774b3d7b455', NULL, 'error', 'Stock processing failed', '{"orderId":1016,"signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"error":"This Job Summary has already been fully processed for stock."}', '2026-04-23 19:24:48');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('40e50e55-eaef-427f-8f23-99e219d2321c', NULL, 'error', 'Stock processing failed', '{"orderId":1016,"signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"error":"This Job Summary has already been fully processed for stock."}', '2026-04-23 19:25:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bd899f13-e663-4e94-b9dc-e612c13880ca', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 19:31:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ef539c35-d58c-4898-9b4c-59cc645cfde0', NULL, 'info', 'Stock processing completed', '{"orderId":1016,"orderName":"S01016","signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 19:33:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('201fa1b0-8b29-4a99-a58b-93494f8eafe6', 'ccfd173d-8e61-49b7-8d04-41409206183b', 'info', 'Extraction started', '{"orderId":2291,"orderName":"S02243","attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf"}', '2026-04-23 19:35:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b7e610b9-705b-4393-a8c5-6702a61e28d6', 'ccfd173d-8e61-49b7-8d04-41409206183b', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","fileSize":78027,"computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","signatureComparison":"match"}', '2026-04-23 19:35:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0baacbee-10b8-4b0a-a490-573482022282', 'ccfd173d-8e61-49b7-8d04-41409206183b', 'info', 'PDF parsing completed', '{"historyId":"ccfd173d-8e61-49b7-8d04-41409206183b","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."],"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","signatureComparison":"match"}', '2026-04-23 19:35:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6a68a994-630d-40f6-ac2b-411f7284e8de', 'ccfd173d-8e61-49b7-8d04-41409206183b', 'info', 'Structured data sent to Odoo', '{"historyId":"ccfd173d-8e61-49b7-8d04-41409206183b","orderId":2291,"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 19:36:07');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('486de9ef-f42f-4863-b817-e64fba0154cb', NULL, 'warn', 'Stock additions reversed', '{"orderId":2291,"reversedCount":1,"affectedVariants":1,"itemIds":["2ce8d5f1-3d63-4dee-b7b2-5e3718838b35"]}', '2026-04-23 19:37:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('43157327-9854-4497-bfb5-6806a3eadb5c', NULL, 'info', 'Stock processing completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 19:37:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('93ab97b1-1321-41db-b29c-91a345e9dd51', NULL, 'warn', 'Stock additions reversed', '{"orderId":2296,"reversedCount":1,"affectedVariants":1,"itemIds":["a962ff1b-2884-420c-807e-4d4055b9ec84"]}', '2026-04-23 19:38:38');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1a4a8562-5dd9-4be4-88cb-a7e8f0b476e7', NULL, 'info', 'Stock processing completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[]}', '2026-04-23 19:39:04');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2d697052-df5d-4ff6-a266-abad90ed7624', '8e055e9d-ba32-48ae-80b9-36693470612b', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-23 19:42:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2982c421-6455-4d4f-b0ea-31b3d86d4ac0', '8e055e9d-ba32-48ae-80b9-36693470612b', 'info', 'Structured data sent to Odoo', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 19:42:48');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('849dc63a-e204-4aff-b951-41411611bd17', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 19:43:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4cb4f2b9-d644-4add-a8ad-49ea0b500a7a', '8e055e9d-ba32-48ae-80b9-36693470612b', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-23 19:51:14');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('358de3a9-5425-4720-8e8a-41785d72abe2', '8e055e9d-ba32-48ae-80b9-36693470612b', 'info', 'Structured data sent to Odoo', '{"historyId":"8e055e9d-ba32-48ae-80b9-36693470612b","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 19:51:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b15867df-f737-489d-828a-9ca303e626e7', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 19:56:29');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('cb3b7eaa-e328-4fe7-94f7-5e8611e596cd', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 20:52:55');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6cd1278d-f0b3-4493-a6d8-319d3dd4105c', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 21:21:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('e874088a-0e7a-4b09-abbd-bf4100af9113', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 21:22:03');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('894eb085-4870-4fb0-bb99-bb5179789819', '26fb5937-ef5e-4562-9b02-602cb6844bad', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-23 21:22:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3f265fbc-ed8f-4a64-8965-dea7fec3abc1', '26fb5937-ef5e-4562-9b02-602cb6844bad', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 21:22:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ba14045e-a315-4fd4-ac23-ba991b91faf4', '26fb5937-ef5e-4562-9b02-602cb6844bad', 'info', 'PDF parsing completed', '{"historyId":"26fb5937-ef5e-4562-9b02-602cb6844bad","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Detected edging entry \\"Esperanza 1mm\\".","Detected edging entry \\"Neuro 1mm\\".","Detected edging entry \\"White 1mm\\".","Detected edging entry \\"White Marble 1mm\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 21:22:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('337be74b-b2f5-4ad4-9b7f-d8c4356bbc91', '26fb5937-ef5e-4562-9b02-602cb6844bad', 'info', 'Structured data sent to Odoo', '{"historyId":"26fb5937-ef5e-4562-9b02-602cb6844bad","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 21:22:44');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('28266856-e419-445e-8fb5-b00ddb59dfce', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 21:26:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('96b70a1b-545b-4a06-bbc6-cb3247ac49d3', NULL, 'warn', 'Stock additions reversed', '{"orderId":2266,"reversedCount":0,"affectedVariants":0,"itemIds":[]}', '2026-04-23 21:26:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('76240763-dbf6-466b-ab77-11752a7c79a7', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 22:10:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0a71396f-91f7-4a6f-80cf-401f4e2e974d', 'd5ba4106-4f29-4c60-99f0-4084151c2a08', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-23 22:22:30');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('acc1f68f-57cb-485f-b318-ccb35564473c', 'd5ba4106-4f29-4c60-99f0-4084151c2a08', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 22:22:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4b574341-7331-47bc-8eb5-ebbc168db5ba', 'd5ba4106-4f29-4c60-99f0-4084151c2a08', 'info', 'PDF parsing completed', '{"historyId":"d5ba4106-4f29-4c60-99f0-4084151c2a08","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 22:22:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7f6129bd-3acd-4c39-b380-d380bbba5da8', 'd5ba4106-4f29-4c60-99f0-4084151c2a08', 'info', 'Structured data sent to Odoo', '{"historyId":"d5ba4106-4f29-4c60-99f0-4084151c2a08","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 22:22:43');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fd3c3bee-de18-47e4-8be1-fc2d16058964', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 22:30:21');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('647622db-917e-4c0c-a5de-dfad825bdf51', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-23 22:31:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('486d3df7-3e1c-4e2e-af8e-ae0afefd2d44', '2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-23 22:32:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('eb6008e9-e326-461d-ac69-0de474919d4f', '2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 22:32:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6dc29f69-b515-4b3c-bda5-b5942b55574c', '2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 'info', 'PDF parsing completed', '{"historyId":"2c1e0bb9-7078-4051-9c88-d6d4064b78e8","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-23 22:32:23');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3aa5fb69-a3b4-4778-80eb-00483bccb531', '2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 'info', 'Structured data sent to Odoo', '{"historyId":"2c1e0bb9-7078-4051-9c88-d6d4064b78e8","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 22:33:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6cf04699-3e85-47ab-a33e-f0b80e9d2ef1', NULL, 'info', 'Stock processing completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"delta_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":2},"missingSoProducts":[]}', '2026-04-23 22:35:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('59de10d8-c582-4f8e-804b-f28895f1d056', 'f82dc724-b182-4b9f-a555-f8220c1af598', 'info', 'Extraction started', '{"orderId":2257,"orderName":"S02209","attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf"}', '2026-04-23 22:41:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6ae394d2-c98a-4a7f-814a-f30e6d05210e', 'f82dc724-b182-4b9f-a555-f8220c1af598', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","fileSize":78722,"computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","signatureComparison":"match"}', '2026-04-23 22:41:29');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ea1a5892-4b5d-4f0b-a12a-a8666191ee23', 'f82dc724-b182-4b9f-a555-f8220c1af598', 'info', 'PDF parsing completed', '{"historyId":"f82dc724-b182-4b9f-a555-f8220c1af598","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"37006 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Extracted 1 edging material item(s)."],"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","signatureComparison":"match"}', '2026-04-23 22:41:29');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4ae4d859-fd14-42ac-8127-56376aa15fa3', 'f82dc724-b182-4b9f-a555-f8220c1af598', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"f82dc724-b182-4b9f-a555-f8220c1af598","orderId":2257,"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-23 22:43:28');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7fea9f01-a91e-41f6-9904-c5ce3d5a8840', 'f82dc724-b182-4b9f-a555-f8220c1af598', 'info', 'Structured data sent to Odoo', '{"historyId":"f82dc724-b182-4b9f-a555-f8220c1af598","orderId":2257,"attachmentId":8114,"attachmentName":"Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","storedOdooSignature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-23 22:43:37');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('cb4744a6-4dcb-456f-a350-6013b275b0cd', NULL, 'info', 'Stock processing completed', '{"orderId":2257,"orderName":"S02209","signature":"5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0","preview":false,"source":"delta_json","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":1},"missingSoProducts":[]}', '2026-04-23 22:44:03');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('45f66139-caba-4da0-abcf-cf2decad781e', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 07:35:43');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2b76987c-2b3d-433c-9f72-b2fdd239e2e4', 'a5acbfd2-b9c8-4ec7-922f-ceea67d42f53', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-24 07:40:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d47cd08b-3544-42c2-97c5-8fee2e5c0577', 'a5acbfd2-b9c8-4ec7-922f-ceea67d42f53', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 07:40:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c51c6195-bfd1-4c3b-8814-007918a9c153', 'a5acbfd2-b9c8-4ec7-922f-ceea67d42f53', 'info', 'PDF parsing completed', '{"historyId":"a5acbfd2-b9c8-4ec7-922f-ceea67d42f53","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 07:40:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c2304413-0b50-49a0-bdfb-8035e20037a3', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 07:55:14');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('e6fd233d-d711-4f64-8092-f7cd2ec789f6', '77c761f2-fa7e-4ff7-8aa3-f61b1656f998', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-24 07:57:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c31b4ebe-0e4e-4312-b3e1-0edf99c25b0a', '77c761f2-fa7e-4ff7-8aa3-f61b1656f998', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 07:57:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fe0d827c-a0b5-4d64-9c8c-4357962e3137', '77c761f2-fa7e-4ff7-8aa3-f61b1656f998', 'info', 'PDF parsing completed', '{"historyId":"77c761f2-fa7e-4ff7-8aa3-f61b1656f998","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured used length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured used length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured used length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured used length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured used length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured used length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 07:57:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('824c0c03-aad0-4329-bd4f-39d258e62a46', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 09:26:13');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('36f50abe-dde0-4142-947d-a9056d3aa711', 'e400cde1-1a87-44da-a20b-39cc32e18957', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-24 09:27:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5a842234-6440-4816-b458-bbbeffcb2c26', 'e400cde1-1a87-44da-a20b-39cc32e18957', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 09:27:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4f9f506e-e92b-4bfa-b208-5dead973b0ab', 'e400cde1-1a87-44da-a20b-39cc32e18957', 'info', 'PDF parsing completed', '{"historyId":"e400cde1-1a87-44da-a20b-39cc32e18957","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured roll length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured roll length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured roll length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured roll length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured roll length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 09:27:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8580f7b7-e3de-4e25-9038-e594862de85b', 'e400cde1-1a87-44da-a20b-39cc32e18957', 'info', 'Structured data sent to Odoo', '{"historyId":"e400cde1-1a87-44da-a20b-39cc32e18957","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 09:29:12');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('307695c8-18b1-4cd4-99d8-a51511fce980', NULL, 'warn', 'Stock additions reversed', '{"orderId":2266,"reversedCount":0,"affectedVariants":0,"itemIds":[]}', '2026-04-24 09:29:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('05c219e6-6039-4751-9c12-b394eb1bff5a', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"stock_adjustment_input_json","summary":{"totalItems":6,"processedCount":3,"skippedCount":3,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Caraz","normalizedColor":"Caraz","length_mm":150000,"usedMeters":150,"orderedMeters":153,"quantityToAddMeters":3,"expectedSoProduct":"Edge Banding Service Caraz","matchedSoProductName":"Edge banding service Caraz","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (caraz)","variantId":786,"currentStock":65,"newStock":68,"status":"processed","skipReason":""},{"extractedColor":"Esperanza","normalizedColor":"Esperanza","length_mm":150000,"usedMeters":150,"orderedMeters":171,"quantityToAddMeters":21,"expectedSoProduct":"Edge Banding Service Esperanza","matchedSoProductName":"Edge Banding  Service Esperanza","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (Esperanza)","variantId":114,"currentStock":195,"newStock":216,"status":"processed","skipReason":""},{"extractedColor":"Neuro","normalizedColor":"Neuro","length_mm":15000,"usedMeters":15,"orderedMeters":34,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Neuro","matchedSoProductName":"Edge Banding Service Neuro","moMatched":true,"moState":"draft","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"},{"extractedColor":"White","normalizedColor":"White","length_mm":15000,"usedMeters":15,"orderedMeters":230,"quantityToAddMeters":215,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (White)","variantId":108,"currentStock":1623.8,"newStock":1838.8,"status":"processed","skipReason":""},{"extractedColor":"White Marble","normalizedColor":"White Marble","length_mm":150000,"usedMeters":150,"orderedMeters":33,"quantityToAddMeters":-117,"expectedSoProduct":"Edge Banding Service White Marble","matchedSoProductName":"Edge banding service White Marble","moMatched":true,"moState":"done","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Job Summary usage exceeds Sales Order quantity for White Marble"},{"extractedColor":"Zalzach","normalizedColor":"Zalzach","length_mm":150000,"usedMeters":150,"orderedMeters":53,"quantityToAddMeters":-97,"expectedSoProduct":"Edge Banding Service Zalzach","matchedSoProductName":"Edge Banding Service Zalzach","moMatched":true,"moState":"done","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Job Summary usage exceeds Sales Order quantity for Zalzach"}]}', '2026-04-24 09:30:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f4af3464-8806-46c7-9067-731f1ba2f99e', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 09:54:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7cb14899-c8ce-4f10-9f3d-cf6c2b5afdd6', 'cd9f5c84-7f81-4174-bba9-b030c253ced1', 'info', 'Extraction started', '{"orderId":2266,"orderName":"S02218","attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf"}', '2026-04-24 09:56:38');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8510bb67-6c04-40c2-93e1-b9ca2fb89f4d', 'cd9f5c84-7f81-4174-bba9-b030c253ced1', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fileSize":81164,"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 09:56:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0d68baa3-bdd1-4ed1-be21-20b7d4befced', 'cd9f5c84-7f81-4174-bba9-b030c253ced1', 'info', 'PDF parsing completed', '{"historyId":"cd9f5c84-7f81-4174-bba9-b030c253ced1","itemsExtracted":6,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured roll length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured roll length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured roll length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured roll length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured roll length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."],"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","signatureComparison":"match"}', '2026-04-24 09:56:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6a66eaf2-3059-4e0e-a6d6-12916532d716', 'cd9f5c84-7f81-4174-bba9-b030c253ced1', 'info', 'Structured data sent to Odoo', '{"historyId":"cd9f5c84-7f81-4174-bba9-b030c253ced1","orderId":2266,"attachmentId":8149,"attachmentName":"Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","storedOdooSignature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 09:56:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a7431c0a-1111-44f1-97b0-e24f20c3da8f', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2266,"orderName":"S02218","signature":"67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc","preview":false,"source":"latest_extraction","summary":{"totalItems":6,"processedCount":5,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Caraz","normalizedColor":"Caraz","length_mm":133928,"usedMeters":134,"orderedMeters":153,"quantityToAddMeters":19,"expectedSoProduct":"Edge Banding Service Caraz","matchedSoProductName":"Edge banding service Caraz","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (caraz)","variantId":786,"currentStock":68,"newStock":87,"status":"processed","skipReason":""},{"extractedColor":"Esperanza","normalizedColor":"Esperanza","length_mm":149330,"usedMeters":149,"orderedMeters":171,"quantityToAddMeters":22,"expectedSoProduct":"Edge Banding Service Esperanza","matchedSoProductName":"Edge Banding  Service Esperanza","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (Esperanza)","variantId":114,"currentStock":216,"newStock":238,"status":"processed","skipReason":""},{"extractedColor":"Neuro","normalizedColor":"Neuro","length_mm":29828,"usedMeters":30,"orderedMeters":34,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Neuro","matchedSoProductName":"Edge Banding Service Neuro","moMatched":true,"moState":"draft","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"},{"extractedColor":"White","normalizedColor":"White","length_mm":220028,"usedMeters":220,"orderedMeters":230,"quantityToAddMeters":10,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (White)","variantId":108,"currentStock":1838.8,"newStock":1848.8,"status":"processed","skipReason":""},{"extractedColor":"White Marble","normalizedColor":"White Marble","length_mm":23000,"usedMeters":23,"orderedMeters":33,"quantityToAddMeters":10,"expectedSoProduct":"Edge Banding Service White Marble","matchedSoProductName":"Edge banding service White Marble","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (Marble white)","variantId":785,"currentStock":167,"newStock":177,"status":"processed","skipReason":""},{"extractedColor":"Zalzach","normalizedColor":"Zalzach","length_mm":43360,"usedMeters":43,"orderedMeters":53,"quantityToAddMeters":10,"expectedSoProduct":"Edge Banding Service Zalzach","matchedSoProductName":"Edge Banding Service Zalzach","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (Zalzach)","variantId":229,"currentStock":305,"newStock":315,"status":"processed","skipReason":""}]}', '2026-04-24 09:57:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0806f9b6-9ea5-4c60-aa1e-357f68a08673', '82075034-4257-4ac4-9cd5-4d98a79c525e', 'info', 'Extraction started', '{"orderId":2263,"orderName":"S02215","attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf"}', '2026-04-24 10:26:06');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0ffb06cd-c796-4400-8c3b-b30821503179', '82075034-4257-4ac4-9cd5-4d98a79c525e', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","fileSize":77906,"computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","signatureComparison":"match"}', '2026-04-24 10:26:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a50cfa60-eb3a-4c0e-86b4-1aeb89eb97de', '82075034-4257-4ac4-9cd5-4d98a79c525e', 'info', 'PDF parsing completed', '{"historyId":"82075034-4257-4ac4-9cd5-4d98a79c525e","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Cappuccino 1mm\\".","Captured thickness \\"1 mm\\" for \\"Cappuccino\\".","Captured used length \\"2800 mm\\" for \\"Cappuccino\\".","Captured roll length \\"150000 mm\\" for \\"Cappuccino\\".","Extracted 1 edging material item(s)."],"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","signatureComparison":"match"}', '2026-04-24 10:26:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1b2b31c8-204e-4d4e-818f-0b882e2e9cc9', '82075034-4257-4ac4-9cd5-4d98a79c525e', 'info', 'Structured data sent to Odoo', '{"historyId":"82075034-4257-4ac4-9cd5-4d98a79c525e","orderId":2263,"attachmentId":8129,"attachmentName":"Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","storedOdooSignature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 10:26:18');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('0cfa93ff-4b39-49eb-8411-1140a2725ccb', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2263,"orderName":"S02215","signature":"fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":1},"missingSoProducts":[],"items":[{"extractedColor":"Cappuccino","normalizedColor":"Cappuccino","length_mm":2800,"usedMeters":3,"orderedMeters":3,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Cappuccino","matchedSoProductName":"Edge Banding Service Cappuccino ","moMatched":true,"moState":"done","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"No unused quantity to add"}]}', '2026-04-24 10:26:32');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8bc307a4-1e87-4a61-b4b0-8879ede1459e', '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 'info', 'Extraction started', '{"orderId":2261,"orderName":"S02213","attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf"}', '2026-04-24 10:27:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7a01cd66-cd5f-46cd-88f8-1109532fc740', '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","fileSize":77977,"computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","signatureComparison":"match"}', '2026-04-24 10:27:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('47093a3d-a993-4bfd-9421-64e4bd9d85ca', '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 'info', 'PDF parsing completed', '{"historyId":"2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"15528 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","signatureComparison":"match"}', '2026-04-24 10:27:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('86c92922-6e83-4be1-ab5e-eab6d3dc9457', '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 'info', 'Structured data sent to Odoo', '{"historyId":"2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb","orderId":2261,"attachmentId":8122,"attachmentName":"Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","storedOdooSignature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 10:27:58');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('83c4902c-fc8f-4e25-a9de-9cee81b1d423', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2261,"orderName":"S02213","signature":"79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":15528,"usedMeters":16,"orderedMeters":17,"quantityToAddMeters":1,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (White)","variantId":108,"currentStock":313.8,"newStock":314.8,"status":"processed","skipReason":""}]}', '2026-04-24 10:28:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('10f82806-65b5-4136-9574-181ec9769166', '459f91e2-0023-4e72-9613-f7b94c36c750', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 10:47:44');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f42101b2-4284-47b0-bb1b-9188f75fbdbe', '459f91e2-0023-4e72-9613-f7b94c36c750', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 10:47:46');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f80d7370-0f7f-4231-9025-87810c8bdc2b', '459f91e2-0023-4e72-9613-f7b94c36c750', 'info', 'PDF parsing completed', '{"historyId":"459f91e2-0023-4e72-9613-f7b94c36c750","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 10:47:48');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('818b564e-c44c-489b-9059-d8596f4ac527', '459f91e2-0023-4e72-9613-f7b94c36c750', 'info', 'Structured data sent to Odoo', '{"historyId":"459f91e2-0023-4e72-9613-f7b94c36c750","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 10:48:06');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('53eca4e8-0317-4892-bac3-a008b835c89c', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 10:48:30');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('121c7e97-8367-4f16-97ca-97d0f0d337c6', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 19:27:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('22b2a901-8e52-436a-beb9-2f487add04f0', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 20:17:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b5cf0d4c-1d3c-4b2b-b32a-38fc8f93fa07', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 21:23:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('20828339-1ce4-47a0-927c-b4317695524a', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 21:24:12');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7a38aa1e-4b3d-42ef-8466-3d3ffcde125e', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:25:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6f5e6a19-a10b-4ff0-89e9-74ca1bb7c108', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:27:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b5abe338-7109-4b7f-9283-b4628467a5c3', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:29:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('08c8fdb8-1375-4447-9339-8192ca19639b', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:29:34');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f4e257cf-5779-450c-840f-7ff5624ce77e', NULL, 'info', 'Login code sent', '{"email":"leoivardomondi@flowcode.co.ke","ipAddress":"::1"}', '2026-04-24 21:42:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('be63d6d0-3d61-45e9-a184-7ab97b50ad61', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:42:13');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8b2221fc-e38f-44fc-8033-4033d9943a83', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 21:51:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9bdc097e-ef49-4de6-ac78-73fe56b256a5', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 22:07:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('51d6c0f7-22a1-442a-8b5e-1b22062bfff8', NULL, 'info', 'Login code sent', '{"email":"dbadmin@urbanvibeinteriordesign.co.ke","ipAddress":"::1"}', '2026-04-24 22:08:11');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('28df97de-c0a5-4c22-9d0a-bcf6bec3863f', NULL, 'info', 'Local admin password login succeeded', '{"email":"leoivardomondi@flowcode.co.ke","ipAddress":"::1"}', '2026-04-24 22:08:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6a74dfa9-705d-4d74-a0b8-5a5b6f7bd35d', '0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 'info', 'Extraction started', '{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf"}', '2026-04-24 22:11:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('46f219a1-5339-47a9-bdff-224906a24b60', '0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fileSize":78506,"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-24 22:11:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b64739af-04e9-4ff7-a47d-6780fd37227d', '0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 'info', 'PDF parsing completed', '{"historyId":"0b109b08-351e-4663-a8f2-e0d57b0d1fe0","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-24 22:11:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d102d7d2-50f8-4024-bb54-2c1e2b699d3d', '0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 'info', 'Structured data sent to Odoo', '{"historyId":"0b109b08-351e-4663-a8f2-e0d57b0d1fe0","orderId":2298,"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-24 22:11:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('96f5fba8-7c15-4df5-addd-88779d82c67b', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2298,"orderName":"S02250","signature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":171223,"usedMeters":171,"orderedMeters":181,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 22:12:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('531238fc-fb6c-4c8b-a98a-31b4c9aa1992', 'eff11008-3801-4cf2-9724-1c2a87512d8d', 'info', 'Extraction started', '{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf"}', '2026-04-24 22:13:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5d68f6c7-2457-4b7b-8a19-05d7a2564ff8', 'eff11008-3801-4cf2-9724-1c2a87512d8d', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fileSize":78141,"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-24 22:13:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c2306f9a-1fbe-4989-8c36-2f3900c8bbe6', 'eff11008-3801-4cf2-9724-1c2a87512d8d', 'info', 'PDF parsing completed', '{"historyId":"eff11008-3801-4cf2-9724-1c2a87512d8d","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":null,"signatureComparison":"missing"}', '2026-04-24 22:13:28');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a647d69d-34fb-4c99-ae3a-ac239609b397', 'eff11008-3801-4cf2-9724-1c2a87512d8d', 'info', 'Structured data sent to Odoo', '{"historyId":"eff11008-3801-4cf2-9724-1c2a87512d8d","orderId":2302,"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":null,"comparisonResult":"missing","forceSend":false,"signatureWritten":true}', '2026-04-24 22:13:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4dff5515-3631-45fa-a8e3-52696fcf0d31', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2302,"orderName":"S02254","signature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":9140,"usedMeters":9,"orderedMeters":10,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 22:13:59');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f8893231-ea48-4e78-91ac-3e3f1681b175', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2302,"orderName":"S02254","signature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":9140,"usedMeters":9,"orderedMeters":10,"quantityToAddMeters":1,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"progress","componentName":"Edge Band Rolls 1mm (White)","variantId":108,"currentStock":314.8,"newStock":315.8,"status":"processed","skipReason":""}]}', '2026-04-24 22:15:23');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('12dae07f-89cb-43c3-a759-5b242b588642', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"@Leoivard Ongule ,Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-24 22:39:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('fd9f20df-67bb-430f-b908-e5bf386775ff', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 22:40:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2f486545-7352-45ca-8a41-3f4629f6bfa2', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 22:40:44');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('61d7b8b3-d338-421c-8519-2b9ff42013c9', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 'info', 'PDF parsing completed', '{"historyId":"8081dd95-6019-4c55-bfd6-7b6e4ab806d0","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 22:40:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6db87e7a-3012-431b-8570-0f6feb931f8a', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"8081dd95-6019-4c55-bfd6-7b6e4ab806d0","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 22:41:24');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d9af77a9-1898-41aa-a353-7f969c15f712', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 'info', 'Structured data sent to Odoo', '{"historyId":"8081dd95-6019-4c55-bfd6-7b6e4ab806d0","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fieldsUpdated":["x_studio_previous_job_summary_json","x_studio_job_summary_edge_json","x_studio_job_summary_processing_log","x_studio_job_summary_processed","x_studio_job_summary_last_processed_on","x_studio_last_job_summary_filename","x_studio_last_job_summary_attachment_id_1","x_studio_job_summary_signature"],"skippedFields":[],"missingMappings":[],"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":true,"signatureWritten":true}', '2026-04-24 22:41:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f21324ec-cf88-448c-93d1-4df4ccaa0610', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 22:42:45');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('57e5138c-707b-413b-9fe7-5b846d560222', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"@Leoivard Ongule ,Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-24 23:40:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('79f7bed1-f4f8-439d-9acd-4d4bbbe3dee9', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-24 23:40:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7ef41501-a288-4d58-a741-779b1b4d3575', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-24 23:42:58');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('cf564c12-06cd-4645-b71e-c090aaf91608', '98a3b523-1432-4be1-9dfa-e44d84699b28', 'info', 'Extraction started', '{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf"}', '2026-04-24 23:46:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('26465080-cd3f-463f-8432-1aeb880383b3', '98a3b523-1432-4be1-9dfa-e44d84699b28', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fileSize":78141,"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:46:19');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a2c3985d-47d3-4841-8146-855b79e78716', '98a3b523-1432-4be1-9dfa-e44d84699b28', 'info', 'PDF parsing completed', '{"historyId":"98a3b523-1432-4be1-9dfa-e44d84699b28","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:46:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('7570a500-7032-4bf3-9d30-746a85b8a60c', '98a3b523-1432-4be1-9dfa-e44d84699b28', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"98a3b523-1432-4be1-9dfa-e44d84699b28","orderId":2302,"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:46:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('91dfeace-2a50-4307-a74c-18f5b05069fe', '77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 'info', 'Extraction started', '{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf"}', '2026-04-24 23:46:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1c3af826-95a2-4c7e-8931-a5d033228537', '77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fileSize":78506,"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:46:38');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c4c16b3a-1b69-459d-8b7a-653b116884a2', '77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 'info', 'PDF parsing completed', '{"historyId":"77eb90b1-2acf-44fb-bc34-0ecf6ea24198","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:46:38');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4d5a8dbd-7029-48e6-9581-f171ec19634c', '77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"77eb90b1-2acf-44fb-bc34-0ecf6ea24198","orderId":2298,"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:46:40');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d3f6cc49-1a80-4a59-99ba-9c5cfac67f19', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2298,"orderName":"S02250","signature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":171223,"usedMeters":171,"orderedMeters":181,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:46:47');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2caa38af-8073-4f35-a4b2-20e884bb3870', 'b70aceb8-03b5-4719-b9f2-78064e112f49', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 23:46:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('519fa50a-f873-46d1-885e-f762a5eb5602', 'b70aceb8-03b5-4719-b9f2-78064e112f49', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:47:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('6af7744a-af4d-4952-83f4-fe4799a48bbc', 'b70aceb8-03b5-4719-b9f2-78064e112f49', 'info', 'PDF parsing completed', '{"historyId":"b70aceb8-03b5-4719-b9f2-78064e112f49","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:47:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('292a5c58-fc67-4722-a78b-c21c62f8a3f0', 'b70aceb8-03b5-4719-b9f2-78064e112f49', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"b70aceb8-03b5-4719-b9f2-78064e112f49","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:47:01');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('35c230fe-8e08-4918-b286-95a49c0a2fd1', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:47:06');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('af2ce120-63f7-4cb9-af7e-e8e2a732696e', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2281,"orderName":"S02233"}', '2026-04-24 23:47:06');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c9d4332e-036e-44ce-8f91-4457af579b29', 'dc26c861-11de-4186-9943-ed25c0efc705', 'info', 'Extraction started', '{"orderId":2291,"orderName":"S02243","attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf"}', '2026-04-24 23:47:08');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('76887307-c9d6-4281-8eea-4955898be43a', 'dc26c861-11de-4186-9943-ed25c0efc705', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","fileSize":78027,"computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","signatureComparison":"match"}', '2026-04-24 23:47:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('301741dd-10b0-48a5-be61-c7b7fc41377a', 'dc26c861-11de-4186-9943-ed25c0efc705', 'info', 'PDF parsing completed', '{"historyId":"dc26c861-11de-4186-9943-ed25c0efc705","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"43642 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","signatureComparison":"match"}', '2026-04-24 23:47:21');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c3c2c23a-1572-42f1-80cd-113f34685bae', 'dc26c861-11de-4186-9943-ed25c0efc705', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"dc26c861-11de-4186-9943-ed25c0efc705","orderId":2291,"attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","computedSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","storedOdooSignature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:47:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5420e1de-6287-4b37-9944-fb0bcdfc8a46', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2291,"orderName":"S02243","signature":"8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":43642,"usedMeters":44,"orderedMeters":45,"quantityToAddMeters":1,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (White)","variantId":108,"currentStock":315.8,"newStock":316.8,"status":"processed","skipReason":""}]}', '2026-04-24 23:47:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d7ace3f3-4407-42e2-bca4-d1834f282ba5', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2295,"orderName":"S02247"}', '2026-04-24 23:47:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('cd1f2551-1b6b-4a68-88b7-4f0026c3982d', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2294,"orderName":"S02246"}', '2026-04-24 23:47:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d0c2d143-4332-44e3-9d87-8baa31f6cb09', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2293,"orderName":"S02245"}', '2026-04-24 23:47:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('945264ed-d52a-4159-a326-94b3f690d578', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2292,"orderName":"S02244"}', '2026-04-24 23:47:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('286f4dae-9c84-4e83-8338-7c26e96c4287', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2287,"orderName":"S02239"}', '2026-04-24 23:47:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1ee3bfad-fe81-46ce-abfa-45f83f9d9a3b', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2285,"orderName":"S02237"}', '2026-04-24 23:47:37');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4f2e1e85-1a99-4b2d-937e-a891610b58e7', 'ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 'info', 'Extraction started', '{"orderId":1016,"orderName":"S01016","attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf"}', '2026-04-24 23:47:39');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c63097c5-3ffd-4aaf-a930-24799d306cf7', 'ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","fileSize":78718,"computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","signatureComparison":"match"}', '2026-04-24 23:47:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ff15f488-ce74-4a50-995f-3287cf3a09b8', 'ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 'info', 'PDF parsing completed', '{"historyId":"ddc3558c-cbb5-4f50-801c-80f50f4f4a17","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Light grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Light grey\\".","Captured used length \\"68402 mm\\" for \\"Light grey\\".","Captured roll length \\"15000 mm\\" for \\"Light grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","signatureComparison":"match"}', '2026-04-24 23:47:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3ecd8bc4-4def-4fa0-8f06-2a853426e83e', 'ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"ddc3558c-cbb5-4f50-801c-80f50f4f4a17","orderId":1016,"attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","computedSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","storedOdooSignature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:47:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('58938079-69f0-46cf-8458-7ecfa6326189', NULL, 'info', 'Stock reconciliation completed', '{"orderId":1016,"orderName":"S01016","signature":"c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Light grey","normalizedColor":"Light Grey","length_mm":68402,"usedMeters":68,"orderedMeters":73,"quantityToAddMeters":5,"expectedSoProduct":"Edge Banding Service Light Grey","matchedSoProductName":"Edge Banding Service Light Grey ","moMatched":true,"moState":"done","componentName":"Edge Band Rolls 1mm (Light grey)","variantId":112,"currentStock":81,"newStock":86,"status":"processed","skipReason":""}]}', '2026-04-24 23:47:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('3da84f0b-ca52-4d55-b8a1-99bea9aeea6d', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2283,"orderName":"S02235"}', '2026-04-24 23:47:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d5034da1-e2cc-41a7-8d12-495577c40056', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2282,"orderName":"S02234"}', '2026-04-24 23:47:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('202b6f3e-fa0b-4e79-a44f-6d2017d6cc06', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"0da43128-f734-438a-a565-8082042ae4e8","orderId":2274,"orderName":"S02226"}', '2026-04-24 23:47:51');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('27c57923-60ee-4f01-bf6b-4462b94d975f', '714642d5-4301-4ee6-8e1b-356512ecf582', 'info', 'Extraction started', '{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf"}', '2026-04-24 23:55:50');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('06a29da8-b137-4c1b-8c83-a992a2efc417', '714642d5-4301-4ee6-8e1b-356512ecf582', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fileSize":78141,"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:55:54');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1fd43f5d-5fb9-4671-a210-69429fbec99e', '714642d5-4301-4ee6-8e1b-356512ecf582', 'info', 'PDF parsing completed', '{"historyId":"714642d5-4301-4ee6-8e1b-356512ecf582","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:55:55');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('687a81a8-6b19-465b-b186-e52122179443', '714642d5-4301-4ee6-8e1b-356512ecf582', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"714642d5-4301-4ee6-8e1b-356512ecf582","orderId":2302,"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:55:56');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('55a1d6da-1857-487d-b8c7-751a1f0c9ab9', '42944f08-cd7d-42ce-b047-0dbac7967bd3', 'info', 'Extraction started', '{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf"}', '2026-04-24 23:56:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('71e5278f-5882-4b40-80df-aec75475ba2a', '42944f08-cd7d-42ce-b047-0dbac7967bd3', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fileSize":78506,"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:56:04');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('4f81f334-9ce1-4b19-9b41-3b6c07c46d9f', '42944f08-cd7d-42ce-b047-0dbac7967bd3', 'info', 'PDF parsing completed', '{"historyId":"42944f08-cd7d-42ce-b047-0dbac7967bd3","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:56:04');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('5b83dd31-858a-4617-986d-de118fbb01c6', '42944f08-cd7d-42ce-b047-0dbac7967bd3', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"42944f08-cd7d-42ce-b047-0dbac7967bd3","orderId":2298,"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:56:05');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f775d5ca-8fe7-4d45-b39c-cc2f1300a0c3', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2298,"orderName":"S02250","signature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":171223,"usedMeters":171,"orderedMeters":181,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:56:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('17aa4c5f-85a1-4e48-8490-0bfda537101b', '74474ad4-530f-4d79-a62c-fb40b279afab', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 23:56:11');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bb72f508-fff5-4cfe-891b-15681aa9af26', '74474ad4-530f-4d79-a62c-fb40b279afab', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:56:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8463b88d-6244-4a22-ad40-33a84c265a76', '74474ad4-530f-4d79-a62c-fb40b279afab', 'info', 'PDF parsing completed', '{"historyId":"74474ad4-530f-4d79-a62c-fb40b279afab","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:56:17');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2316c82e-d19a-4145-b7bc-8ba6329c2fef', '74474ad4-530f-4d79-a62c-fb40b279afab', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"74474ad4-530f-4d79-a62c-fb40b279afab","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:56:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('acc50785-e1ac-42ef-b448-e415e873ed07', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:56:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d5242603-bc9f-488d-aed8-bbc36bfb3c3b', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"64290e2f-0ef1-4f0f-af23-523a7a5c25e4","orderId":2281,"orderName":"S02233"}', '2026-04-24 23:56:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('bc04d896-7543-45c1-83a3-742df2d5d1bf', '7548e2d9-4129-4028-881d-8deacd2df6b4', 'info', 'Extraction started', '{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf"}', '2026-04-24 23:57:00');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('752f9737-bdce-4783-b066-50b14967e71e', '7548e2d9-4129-4028-881d-8deacd2df6b4', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fileSize":78141,"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:57:15');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f2c7192b-57ff-4f26-8731-72271435798d', '7548e2d9-4129-4028-881d-8deacd2df6b4', 'info', 'PDF parsing completed', '{"historyId":"7548e2d9-4129-4028-881d-8deacd2df6b4","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:57:15');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f49804dd-ffd9-480f-b26d-7fa546fb8ef5', '7548e2d9-4129-4028-881d-8deacd2df6b4', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"7548e2d9-4129-4028-881d-8deacd2df6b4","orderId":2302,"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:57:16');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('76d51b30-7cb8-465c-87b6-62ad30f69ef5', '23312e8b-8a72-43c3-9c6f-003699abdd58', 'info', 'Extraction started', '{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf"}', '2026-04-24 23:57:22');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('15a76c05-c22b-40dd-afc3-55ebcfc406bc', '23312e8b-8a72-43c3-9c6f-003699abdd58', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fileSize":78506,"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:57:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b7bbb9b3-5daa-4fd5-911a-d362b2f04a91', '23312e8b-8a72-43c3-9c6f-003699abdd58', 'info', 'PDF parsing completed', '{"historyId":"23312e8b-8a72-43c3-9c6f-003699abdd58","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:57:26');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d307506d-1db7-4d88-bb48-1098d08d937c', '23312e8b-8a72-43c3-9c6f-003699abdd58', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"23312e8b-8a72-43c3-9c6f-003699abdd58","orderId":2298,"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:57:27');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d14e7400-aeef-4a6c-be43-d1f855db3a65', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2298,"orderName":"S02250","signature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":171223,"usedMeters":171,"orderedMeters":181,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:57:31');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('11f27d09-0b2e-42e1-9ce9-ab916f092c38', '067dfd4d-f412-4962-973a-b5b9e69b190b', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 23:57:33');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1e75aac5-8882-4cd6-b2f7-d5eeac8ae8a5', '067dfd4d-f412-4962-973a-b5b9e69b190b', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:57:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1f123ad5-11fb-47cf-91b1-96fe47e8ef80', '067dfd4d-f412-4962-973a-b5b9e69b190b', 'info', 'PDF parsing completed', '{"historyId":"067dfd4d-f412-4962-973a-b5b9e69b190b","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-24 23:57:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1c0c1706-f016-4b8b-84a2-307d294e2a02', '067dfd4d-f412-4962-973a-b5b9e69b190b', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"067dfd4d-f412-4962-973a-b5b9e69b190b","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:57:43');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('b44c73ec-f08e-4c18-b180-eec2b8b46f8a', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:57:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c1f7f5d1-e165-49da-8630-9378d5cb3b71', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"e523094a-9b7d-4822-af77-09dc6f5ec328","orderId":2281,"orderName":"S02233"}', '2026-04-24 23:57:49');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('2c146caa-5ece-4adc-9f8a-ea2e0025cd83', '7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 'info', 'Extraction started', '{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf"}', '2026-04-24 23:59:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1bf4a1fe-9e30-4618-bbdf-4f1df1025ac9', '7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","fileSize":78141,"computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:59:15');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f1647bd6-9c71-4df7-92f9-af1d81aa4795', '7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 'info', 'PDF parsing completed', '{"historyId":"7bbb6d48-a21a-46c3-bf86-eb339439f0d3","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","signatureComparison":"match"}', '2026-04-24 23:59:15');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('ae00a271-03c3-4007-b1db-42967b273237', '7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"7bbb6d48-a21a-46c3-bf86-eb339439f0d3","orderId":2302,"attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","computedSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","storedOdooSignature":"b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:59:16');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9cd93509-de4c-421b-9228-8abd30add362', '486dbc32-2472-4acd-b64b-501909f60ce3', 'info', 'Extraction started', '{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf"}', '2026-04-24 23:59:25');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c6159233-5b2e-432d-83d6-8088c4a60e5b', '486dbc32-2472-4acd-b64b-501909f60ce3', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","fileSize":78506,"computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:59:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('f6db8a89-6940-461b-a83f-4f2d35cf9245', '486dbc32-2472-4acd-b64b-501909f60ce3', 'info', 'PDF parsing completed', '{"historyId":"486dbc32-2472-4acd-b64b-501909f60ce3","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."],"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","signatureComparison":"match"}', '2026-04-24 23:59:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('8f146541-5d0c-46c7-a989-78bfa849b07b', '486dbc32-2472-4acd-b64b-501909f60ce3', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"486dbc32-2472-4acd-b64b-501909f60ce3","orderId":2298,"attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","computedSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","storedOdooSignature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-24 23:59:36');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('c14d23ac-b014-4fd8-a655-9dcf59c95981', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2298,"orderName":"S02250","signature":"ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"White","normalizedColor":"White","length_mm":171223,"usedMeters":171,"orderedMeters":181,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service White","matchedSoProductName":"Edge Banding Service White","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-24 23:59:41');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('9892d70f-61fd-48ce-898f-8f43966b9f16', 'ffeeaa85-9164-4688-a64d-fdca984a2751', 'info', 'Extraction started', '{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf"}', '2026-04-24 23:59:42');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('88b6f470-9032-4cc4-bfb4-14d0db139051', 'ffeeaa85-9164-4688-a64d-fdca984a2751', 'info', 'Attachment downloaded from Odoo', '{"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","fileSize":80008,"computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-25 00:00:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('02958d45-17bc-43e9-af93-edc801be496a', 'ffeeaa85-9164-4688-a64d-fdca984a2751', 'info', 'PDF parsing completed', '{"historyId":"ffeeaa85-9164-4688-a64d-fdca984a2751","itemsExtracted":1,"sectionFound":true,"parserLogs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."],"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","signatureComparison":"match"}', '2026-04-25 00:00:02');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('34221763-be86-479d-a6d7-193e11ef1532', 'ffeeaa85-9164-4688-a64d-fdca984a2751', 'warn', 'Send to Odoo skipped because the PDF signature matched the stored Odoo signature', '{"historyId":"ffeeaa85-9164-4688-a64d-fdca984a2751","orderId":2296,"attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","computedSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","storedOdooSignature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","comparisonResult":"match","forceSend":false,"skipped":true}', '2026-04-25 00:00:04');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('a428d8ab-8c1e-490b-97cb-c7be5bab14e3', NULL, 'info', 'Stock reconciliation completed', '{"orderId":2296,"orderName":"S02248","signature":"cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2","preview":false,"source":"latest_extraction","summary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0},"missingSoProducts":[],"items":[{"extractedColor":"Dark grey","normalizedColor":"Dark Grey","length_mm":99147,"usedMeters":99,"orderedMeters":101,"quantityToAddMeters":0,"expectedSoProduct":"Edge Banding Service Dark Grey","matchedSoProductName":"Edge Banding  Service Dark Grey","moMatched":true,"moState":"confirmed","componentName":"","variantId":null,"currentStock":null,"newStock":null,"status":"skipped","skipReason":"Manufacturing Order is not in progress or done"}]}', '2026-04-25 00:00:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('d6a3c584-e2d5-4d86-ac9c-94c7a6480d77', NULL, 'info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', '{"schedulerRunId":"14882ac3-a6b3-46ca-9792-8f39e23a4d4b","orderId":2281,"orderName":"S02233"}', '2026-04-25 00:00:09');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('07cb397f-8475-4147-a720-63326d9224cb', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"","stockSignatureField":"","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-25 01:13:35');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('74e03605-ecd3-4c66-a50c-3d91a35a347b', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-25 01:15:20');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('17f822b5-88a5-4a20-a76b-6d74285625f6', NULL, 'info', 'Odoo connection test succeeded from settings', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","version":"19.0+e"}', '2026-04-25 01:40:47');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('cc22dd08-bef3-415f-be93-705893cfa553', NULL, 'info', 'Application settings updated', '{"baseUrl":"https://www.urbanvibeinteriordesign.co.ke","username":"dbadmin@urbanvibeinteriordesign.co.ke","fieldMappings":{"edgeJsonField":"x_studio_job_summary_edge_json","processedField":"x_studio_job_summary_processed","processedAtField":"x_studio_job_summary_last_processed_on","logField":"x_studio_job_summary_processing_log","attachmentNameField":"x_studio_last_job_summary_filename","attachmentIdField":"x_studio_last_job_summary_attachment_id_1","previousJsonField":"x_studio_previous_job_summary_json","signatureField":"x_studio_job_summary_signature","stockProcessedField":"x_studio_job_summary_stock_processed","stockSignatureField":"x_studio_job_summary_stock_signature","deltaJsonField":"x_studio_job_summary_delta_json","processingLogField":"x_studio_job_summary_processing_log","lastStatusField":"x_studio_job_summary_status","lastProcessedAtField":"x_studio_job_summary_processed_at","lastAttachmentNameField":"x_studio_job_summary_attachment_name"},"parser":{"filenameKeyword":"job summary","sectionHeader":"Edging Materials","stopHeadersCsv":"","productLinePattern":"^(.*?)(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*mm$","thicknessLabel":"Thickness","lengthLabel":"Length","rollLengthLabel":"Roll Length","postChatterOnSuccess":true,"chatterTemplate":"Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s)."},"invalidFieldSelections":[]}', '2026-04-25 01:44:10');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('37af8818-30ca-46fe-afe0-5861c83cc8cb', NULL, 'info', 'Server started', '{"port":3000,"environment":"development"}', '2026-04-25 09:59:57');
INSERT INTO `logs` (`id`, `history_id`, `level`, `message`, `context_json`, `created_at`) VALUES ('1493f284-59df-47e6-9749-fd7df5cdc377', NULL, 'info', 'Local admin password login succeeded', '{"email":"leoivardomondi@flowcode.co.ke","ipAddress":"::1"}', '2026-04-25 10:09:51');

DELETE FROM `history`;
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('5176a0b0-fb2b-42d6-ab21-b8bdb63954b5', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', 'parsed', 'Extracted 1 edging item(s).', NULL, '906686aa-30ae-441d-b896-f91ad42784e2', '2026-04-17 15:02:42', '2026-04-20 00:18:54', NULL, NULL, 'missing', 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('6829564b-0a9c-41aa-b585-5c90de4337f0', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo with warnings.', NULL, '5d3d2ccb-ce31-40df-9981-b99af69019a2', '2026-04-19 21:12:10', '2026-04-19 21:12:28', NULL, NULL, NULL, 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('d9887058-7396-41fc-8c8c-0d8a0602e01b', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'f71b2fd2-6cc6-4462-8e47-70adfdff18c6', '2026-04-19 21:19:00', '2026-04-19 21:19:09', NULL, NULL, NULL, 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '5939fad1-256b-4f9f-8cd5-6cd0ec2549e6', '2026-04-19 21:55:49', '2026-04-19 21:59:50', NULL, NULL, 'missing', 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 2271, 'S02223', 8154, 'Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'ef26321f-91b0-4fc6-88b3-5932427156b5', '2026-04-19 22:10:39', '2026-04-19 22:19:09', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('dde3c954-805f-4b63-be2e-81667da4ee93', 2250, 'S02202', 8131, 'Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, 'd659c5db-0200-4ae0-ae13-619395171d1d', '2026-04-19 22:21:08', '2026-04-20 03:51:21', 'af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4', 'af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 2263, 'S02215', 8129, 'Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'b8693904-da34-42d6-8b2a-e15190212d01', '2026-04-19 22:21:45', '2026-04-23 17:06:42', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('e044ccaf-c171-4768-a2a6-2c02e0198ff5', 2261, 'S02213', 8122, 'Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'd527106e-53b6-4f16-973d-6baf2a3b21f2', '2026-04-19 22:22:30', '2026-04-19 22:22:54', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('9582769e-8ea6-4c5e-8397-4b5349f96209', 2260, 'S02212', 8124, 'Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'ccea3291-a608-447b-87dc-b76f95465ebd', '2026-04-19 22:40:37', '2026-04-19 22:41:02', '144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f', '144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('e75c06c3-7f3d-4421-a784-3b35100d8e5f', 2271, 'S02223', 8154, 'Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '33346017-0a76-4451-b161-c9b7fa3957f8', '2026-04-20 00:36:31', '2026-04-20 00:36:47', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('9d13dad5-4414-47d0-9ba8-47d66bba4630', 2219, 'S02171', 7961, 'Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf', 'sent_to_odoo', 'Sent 2 extracted item(s) to Odoo.', NULL, 'f4c4aae2-9397-4b9c-a220-5ba25583ac1a', '2026-04-20 00:39:07', '2026-04-20 00:39:28', '7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d', '7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('c51b397a-b644-46dc-9186-c65d98a68011', 2220, 'S02172', 7963, 'Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '7edcf0be-2b82-417a-8131-0f0f175d848e', '2026-04-20 00:42:47', '2026-04-20 00:43:02', '58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807', '58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('332b77ee-c992-4b03-807f-5d87ae8e9aa8', 1028, 'S01028', 8147, 'Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf', 'parsed', 'Extracted 1 edging item(s).', NULL, '7091ec0e-0e86-46fd-918b-54c74a87f0f7', '2026-04-20 00:43:45', '2026-04-20 00:43:47', '70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739', NULL, 'missing', 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('01cda4bb-6318-43be-9f2f-5e5a98278b5d', 1028, 'S01028', 8147, 'Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'c0268b9e-26ea-4345-9c0a-8ca0c3d2b615', '2026-04-20 00:55:32', '2026-04-20 00:55:59', '70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739', '70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('698a95b6-ae57-4bda-a747-643e345ea2e0', 2257, 'S02209', 8114, 'Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '5d509779-9f5a-4835-9ca9-6f7dc7a42126', '2026-04-20 04:03:23', '2026-04-20 04:03:37', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('42e1473b-90a1-4e97-842c-ddc6eddd2b38', 1016, 'S01016', 8199, 'Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'bd817693-8be7-4018-a75d-845ad695954d', '2026-04-21 23:30:23', '2026-04-23 21:28:16', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '04822cf4-ee38-4b24-910b-f5a8af3b504c', '2026-04-23 12:57:31', '2026-04-23 12:57:44', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('c52ea6a3-4127-4eb7-825f-8a866562bd16', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '3e3a7954-7dfd-4f41-a3ae-4dddc87ff597', '2026-04-23 15:10:00', '2026-04-23 19:35:25', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('8e055e9d-ba32-48ae-80b9-36693470612b', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, '671323e0-b021-40ed-8ab0-034ace97d124', '2026-04-23 15:49:54', '2026-04-23 19:51:25', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('ccfd173d-8e61-49b7-8d04-41409206183b', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '995a0476-f460-4453-ab04-82f8bba3ba03', '2026-04-23 19:35:54', '2026-04-23 19:36:08', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('26fb5937-ef5e-4562-9b02-602cb6844bad', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, '4f216840-0a0e-4f4b-b6d8-fac11809a966', '2026-04-23 21:22:22', '2026-04-23 21:22:45', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('d5ba4106-4f29-4c60-99f0-4084151c2a08', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, 'f57a5f23-7a79-49a1-b856-d96a5ef179fa', '2026-04-23 22:22:30', '2026-04-23 22:22:44', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, '5504c66e-9ec2-4d2f-8dbe-b10e81fa1afd', '2026-04-23 22:32:19', '2026-04-23 22:33:40', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('f82dc724-b182-4b9f-a555-f8220c1af598', 2257, 'S02209', 8114, 'Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '620b6f08-22fb-4e3f-8cc0-7c868913596a', '2026-04-23 22:41:25', '2026-04-23 22:43:38', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('a5acbfd2-b9c8-4ec7-922f-ceea67d42f53', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'parsed', 'Extracted 6 edging item(s).', NULL, '65353d37-cfbe-4595-80cb-c0534b78e533', '2026-04-24 07:40:39', '2026-04-24 07:57:19', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('77c761f2-fa7e-4ff7-8aa3-f61b1656f998', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'parsed', 'Extracted 6 edging item(s).', NULL, '8e46e267-3686-47ec-8ade-3c9f19aa8f13', '2026-04-24 07:57:31', '2026-04-24 09:56:06', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('e400cde1-1a87-44da-a20b-39cc32e18957', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, '2aafadf9-c0c2-488e-8fe6-f55b4c2d7fb8', '2026-04-24 09:27:02', '2026-04-24 09:56:20', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('cd9f5c84-7f81-4174-bba9-b030c253ced1', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', 'sent_to_odoo', 'Sent 6 extracted item(s) to Odoo.', NULL, '0d1bdc67-26bf-4a69-b619-855a12a02985', '2026-04-24 09:56:38', '2026-04-24 09:56:52', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('82075034-4257-4ac4-9cd5-4d98a79c525e', 2263, 'S02215', 8129, 'Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '38c51bbd-db52-4359-bb49-58e878cd8001', '2026-04-24 10:26:06', '2026-04-24 10:26:19', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 2261, 'S02213', 8122, 'Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, 'bce54459-5ec4-409f-b460-20d27d078d3e', '2026-04-24 10:27:33', '2026-04-24 10:28:00', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('459f91e2-0023-4e72-9613-f7b94c36c750', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '7616c982-1873-4817-83d4-e26b87e7d9a9', '2026-04-24 10:47:44', '2026-04-24 10:48:08', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '386b4ab6-3875-4ee9-a520-10c40cfc7437', '2026-04-24 22:11:22', '2026-04-24 22:11:42', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('eff11008-3801-4cf2-9724-1c2a87512d8d', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '9a9ace69-0412-4b1c-9e8c-5e04dd80962f', '2026-04-24 22:13:25', '2026-04-24 22:13:46', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'sent_to_odoo', 'Sent 1 extracted item(s) to Odoo.', NULL, '1dd5f134-a34a-4ad0-8314-c885e819e549', '2026-04-24 22:40:42', '2026-04-24 22:41:32', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 0, 1);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('98a3b523-1432-4be1-9dfa-e44d84699b28', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '611fb6cb-f628-430a-b8c5-ddacde9d2430', '2026-04-24 23:46:01', '2026-04-24 23:46:21', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '372a9293-e5c4-4389-b148-d91b6ba4e6b6', '2026-04-24 23:46:26', '2026-04-24 23:46:40', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('b70aceb8-03b5-4719-b9f2-78064e112f49', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '9581920a-abd8-4034-9ee4-6bf8af213406', '2026-04-24 23:46:49', '2026-04-24 23:47:01', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('dc26c861-11de-4186-9943-ed25c0efc705', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, 'ed697349-b7f6-486f-bafd-868f1ec71b0b', '2026-04-24 23:47:08', '2026-04-24 23:47:26', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 1016, 'S01016', 8199, 'Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '3bd53e0c-1a15-4843-ad9a-95033aacaad1', '2026-04-24 23:47:39', '2026-04-24 23:47:42', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('714642d5-4301-4ee6-8e1b-356512ecf582', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, 'c735575d-b7e8-43be-955c-6c04b51e16a6', '2026-04-24 23:55:50', '2026-04-24 23:55:56', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('42944f08-cd7d-42ce-b047-0dbac7967bd3', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '8dfe88c1-0b80-40e5-ae94-eebb23aa0fa4', '2026-04-24 23:56:02', '2026-04-24 23:56:05', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('74474ad4-530f-4d79-a62c-fb40b279afab', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '636876c7-44c5-429d-9188-547eeb17aaae', '2026-04-24 23:56:11', '2026-04-24 23:56:20', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('7548e2d9-4129-4028-881d-8deacd2df6b4', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '25be761b-412f-4e09-b1b0-2a57512ed5aa', '2026-04-24 23:57:00', '2026-04-24 23:57:16', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('23312e8b-8a72-43c3-9c6f-003699abdd58', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '51d24ca3-5dbf-4264-a6cc-8c44d6164f67', '2026-04-24 23:57:22', '2026-04-24 23:57:27', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('067dfd4d-f412-4962-973a-b5b9e69b190b', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '7c6c3e4f-9daa-4272-82f4-18b62e5079c0', '2026-04-24 23:57:33', '2026-04-24 23:57:43', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '7fa3fb0f-5554-48c8-b179-8390cd82d475', '2026-04-24 23:59:09', '2026-04-24 23:59:16', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('486dbc32-2472-4acd-b64b-501909f60ce3', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, 'd4d7277e-5b37-4b71-8f47-4707aaa3e2ae', '2026-04-24 23:59:25', '2026-04-24 23:59:36', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f', 'match', 1, 0);
INSERT INTO `history` (`id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `status`, `summary`, `error_message`, `extracted_result_id`, `created_at`, `updated_at`, `computed_signature`, `stored_signature`, `signature_comparison`, `send_skipped`, `signature_written`) VALUES ('ffeeaa85-9164-4688-a64d-fdca984a2751', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', 'signature_unchanged_skipped', 'Skipped send because the Job Summary PDF signature matches Odoo.', NULL, '4813a88f-1ba3-41aa-a7c5-96ece39c8833', '2026-04-24 23:59:42', '2026-04-25 00:00:04', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 'match', 1, 0);

DELETE FROM `extracted_results`;
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('906686aa-30ae-441d-b896-f91ad42784e2', '5176a0b0-fb2b-42d6-ab21-b8bdb63954b5', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', '{"items":[{"color":"Versasca","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Versasca 1mm\\nThickness : 1 mm\\nLength : 284060 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR101\\nClient Name : DIEMS INTERIORSOptimized Sheets : 22\\nJob Reference : -Total Panels : 82\\nDate Required : 4/13/2026Job Wastage : 13.35 %\\nPhone Number :Job Cut Length : 303698 mm\\nFax Number :Unique Layouts : 7\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nSUEZ OAK\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  82\\nSheets :  22\\nMaterial Cut Length :  303698 mm\\nMaterial Wastage :  13.35 %\\nArea :  56.748 m²\\nEdging Materials\\nVersasca 1mm\\nThickness :  1 mm\\nLength :  284060 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR101
Client Name : DIEMS INTERIORSOptimized Sheets : 22
Job Reference : -Total Panels : 82
Date Required : 4/13/2026Job Wastage : 13.35 %
Phone Number :Job Cut Length : 303698 mm
Fax Number :Unique Layouts : 7
Cell No : SHARONMaterials : 2
Sheet Materials
SUEZ OAK
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  82
Sheets :  22
Material Cut Length :  303698 mm
Material Wastage :  13.35 %
Area :  56.748 m²
Edging Materials
Versasca 1mm
Thickness :  1 mm
Length :  284060 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1', '2026-04-17 15:02:46', NULL);
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('5d3d2ccb-ce31-40df-9981-b99af69019a2', '6829564b-0a9c-41aa-b585-5c90de4337f0', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', '{"items":[{"color":"Versasca","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Versasca 1mm\\nThickness : 1 mm\\nLength : 284060 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR101\\nClient Name : DIEMS INTERIORSOptimized Sheets : 22\\nJob Reference : -Total Panels : 82\\nDate Required : 4/13/2026Job Wastage : 13.35 %\\nPhone Number :Job Cut Length : 303698 mm\\nFax Number :Unique Layouts : 7\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nSUEZ OAK\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  82\\nSheets :  22\\nMaterial Cut Length :  303698 mm\\nMaterial Wastage :  13.35 %\\nArea :  56.748 m²\\nEdging Materials\\nVersasca 1mm\\nThickness :  1 mm\\nLength :  284060 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR101
Client Name : DIEMS INTERIORSOptimized Sheets : 22
Job Reference : -Total Panels : 82
Date Required : 4/13/2026Job Wastage : 13.35 %
Phone Number :Job Cut Length : 303698 mm
Fax Number :Unique Layouts : 7
Cell No : SHARONMaterials : 2
Sheet Materials
SUEZ OAK
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  82
Sheets :  22
Material Cut Length :  303698 mm
Material Wastage :  13.35 %
Area :  56.748 m²
Edging Materials
Versasca 1mm
Thickness :  1 mm
Length :  284060 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1', '2026-04-19 21:12:14', NULL);
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('f71b2fd2-6cc6-4462-8e47-70adfdff18c6', 'd9887058-7396-41fc-8c8c-0d8a0602e01b', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', '{"items":[{"color":"Versasca","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Versasca 1mm\\nThickness : 1 mm\\nLength : 284060 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR101\\nClient Name : DIEMS INTERIORSOptimized Sheets : 22\\nJob Reference : -Total Panels : 82\\nDate Required : 4/13/2026Job Wastage : 13.35 %\\nPhone Number :Job Cut Length : 303698 mm\\nFax Number :Unique Layouts : 7\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nSUEZ OAK\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  82\\nSheets :  22\\nMaterial Cut Length :  303698 mm\\nMaterial Wastage :  13.35 %\\nArea :  56.748 m²\\nEdging Materials\\nVersasca 1mm\\nThickness :  1 mm\\nLength :  284060 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR101
Client Name : DIEMS INTERIORSOptimized Sheets : 22
Job Reference : -Total Panels : 82
Date Required : 4/13/2026Job Wastage : 13.35 %
Phone Number :Job Cut Length : 303698 mm
Fax Number :Unique Layouts : 7
Cell No : SHARONMaterials : 2
Sheet Materials
SUEZ OAK
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  82
Sheets :  22
Material Cut Length :  303698 mm
Material Wastage :  13.35 %
Area :  56.748 m²
Edging Materials
Versasca 1mm
Thickness :  1 mm
Length :  284060 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1', '2026-04-19 21:19:01', NULL);
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('5939fad1-256b-4f9f-8cd5-6cd0ec2549e6', '2ec32b6a-1d29-45c4-a0cc-34e54dda5505', 2230, 'S02182', 8002, 'Job Summarycb7f5372-604a-4757-9272-ce9f1aa6cbef.pdf', '{"items":[{"color":"Versasca","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Versasca 1mm\\nThickness : 1 mm\\nLength : 284060 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR101\\nClient Name : DIEMS INTERIORSOptimized Sheets : 22\\nJob Reference : -Total Panels : 82\\nDate Required : 4/13/2026Job Wastage : 13.35 %\\nPhone Number :Job Cut Length : 303698 mm\\nFax Number :Unique Layouts : 7\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nSUEZ OAK\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  82\\nSheets :  22\\nMaterial Cut Length :  303698 mm\\nMaterial Wastage :  13.35 %\\nArea :  56.748 m²\\nEdging Materials\\nVersasca 1mm\\nThickness :  1 mm\\nLength :  284060 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Versasca 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR101
Client Name : DIEMS INTERIORSOptimized Sheets : 22
Job Reference : -Total Panels : 82
Date Required : 4/13/2026Job Wastage : 13.35 %
Phone Number :Job Cut Length : 303698 mm
Fax Number :Unique Layouts : 7
Cell No : SHARONMaterials : 2
Sheet Materials
SUEZ OAK
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  82
Sheets :  22
Material Cut Length :  303698 mm
Material Wastage :  13.35 %
Area :  56.748 m²
Edging Materials
Versasca 1mm
Thickness :  1 mm
Length :  284060 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/13/2026Page  1 of 1', '2026-04-19 21:55:50', NULL);
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('ef26321f-91b0-4fc6-88b3-5932427156b5', '35b6a34d-8d76-4e5c-aa32-f34f022d40ed', 2271, 'S02223', 8154, 'Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 24330 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR121\\nClient Name : VICTOROptimized Sheets : 4\\nJob Reference : -Total Panels : 11\\nDate Required : 4/18/2026Job Wastage : 28.02 %\\nPhone Number :Job Cut Length : 58922 mm\\nFax Number :Unique Layouts : 3\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  11\\nSheets :  4\\nMaterial Cut Length :  58922 mm\\nMaterial Wastage :  28.02 %\\nArea :  8.571 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  24330 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR121
Client Name : VICTOROptimized Sheets : 4
Job Reference : -Total Panels : 11
Date Required : 4/18/2026Job Wastage : 28.02 %
Phone Number :Job Cut Length : 58922 mm
Fax Number :Unique Layouts : 3
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  11
Sheets :  4
Material Cut Length :  58922 mm
Material Wastage :  28.02 %
Area :  8.571 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  24330 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1', '2026-04-19 22:10:41', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('d659c5db-0200-4ae0-ae13-619395171d1d', 'dde3c954-805f-4b63-be2e-81667da4ee93', 2250, 'S02202', 8131, 'Job Summary146c6a0b-e871-4bbd-ad5d-44b9e13c6ff4.pdf', '{"items":[{"color":"Royal teak","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Royal teak 1mm\\nThickness : 1 mm\\nLength : 12126 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 156826 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR114\\nClient Name : ODERAOptimized Sheets : 18\\nJob Reference : -Total Panels : 195\\nDate Required : 4/16/2026Job Wastage : 16.51 %\\nPhone Number :Job Cut Length : 355751 mm\\nFax Number :Unique Layouts : 18\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  12\\nSheets :  3\\nMaterial Cut Length :  42561.5 mm\\nMaterial Wastage :  23.81 %\\nArea :  6.804 m²\\nROYAL TEAK\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  1\\nMaterial Cut Length :  18924 mm\\nMaterial Wastage :  50.96 %\\nArea :  1.46 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  91\\nSheets :  7\\nMaterial Cut Length :  150995.5 mm\\nMaterial Wastage :  13.20 %\\nArea :  18.087 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  77\\nSheets :  7\\nMaterial Cut Length :  143270 mm\\nMaterial Wastage :  11.77 %\\nArea :  18.384 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 2\\n\\nEdging Materials\\nRoyal teak 1mm\\nThickness :  1 mm\\nLength :  12126 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  156826 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Royal teak 1mm\\".","Detected edging entry \\"White 1mm\\".","Extracted 2 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR114
Client Name : ODERAOptimized Sheets : 18
Job Reference : -Total Panels : 195
Date Required : 4/16/2026Job Wastage : 16.51 %
Phone Number :Job Cut Length : 355751 mm
Fax Number :Unique Layouts : 18
Cell No : SHARONMaterials : 6
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  12
Sheets :  3
Material Cut Length :  42561.5 mm
Material Wastage :  23.81 %
Area :  6.804 m²
ROYAL TEAK
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  1
Material Cut Length :  18924 mm
Material Wastage :  50.96 %
Area :  1.46 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  91
Sheets :  7
Material Cut Length :  150995.5 mm
Material Wastage :  13.20 %
Area :  18.087 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  77
Sheets :  7
Material Cut Length :  143270 mm
Material Wastage :  11.77 %
Area :  18.384 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 2

Edging Materials
Royal teak 1mm
Thickness :  1 mm
Length :  12126 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  156826 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  2 of 2', '2026-04-19 22:21:10', 'af74f65d0eb8f5a065aa1418048ca7a0828b69b9a1fdc1586d5905dc07939ac4');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('b8693904-da34-42d6-8b2a-e15190212d01', '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', 2263, 'S02215', 8129, 'Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf', '{"items":[{"color":"Cappuccino","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Cappuccino 1mm\\nThickness : 1 mm\\nLength : 2800 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR117\\nClient Name : ALPHAYOOptimized Sheets : 1\\nJob Reference : -Total Panels : 2\\nDate Required : 4/17/2026Job Wastage : 91.77 %\\nPhone Number :Job Cut Length : 9216 mm\\nFax Number :Unique Layouts : 1\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nCAPPUCCINO PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  9216 mm\\nMaterial Wastage :  91.77 %\\nArea :  0.245 m²\\nEdging Materials\\nCappuccino 1mm\\nThickness :  1 mm\\nLength :  2800 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Cappuccino 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR117
Client Name : ALPHAYOOptimized Sheets : 1
Job Reference : -Total Panels : 2
Date Required : 4/17/2026Job Wastage : 91.77 %
Phone Number :Job Cut Length : 9216 mm
Fax Number :Unique Layouts : 1
Cell No : SHARONMaterials : 2
Sheet Materials
CAPPUCCINO PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  9216 mm
Material Wastage :  91.77 %
Area :  0.245 m²
Edging Materials
Cappuccino 1mm
Thickness :  1 mm
Length :  2800 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1', '2026-04-19 22:21:47', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('d527106e-53b6-4f16-973d-6baf2a3b21f2', 'e044ccaf-c171-4768-a2a6-2c02e0198ff5', 2261, 'S02213', 8122, 'Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 15528 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR116\\nClient Name : FREDRICK OUMAOptimized Sheets : 2\\nJob Reference : -Total Panels : 8\\nDate Required : 4/17/2026Job Wastage : 53.55 %\\nPhone Number :Job Cut Length : 28228 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  8\\nSheets :  2\\nMaterial Cut Length :  28228 mm\\nMaterial Wastage :  53.55 %\\nArea :  2.766 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  15528 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR116
Client Name : FREDRICK OUMAOptimized Sheets : 2
Job Reference : -Total Panels : 8
Date Required : 4/17/2026Job Wastage : 53.55 %
Phone Number :Job Cut Length : 28228 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  8
Sheets :  2
Material Cut Length :  28228 mm
Material Wastage :  53.55 %
Area :  2.766 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  15528 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1', '2026-04-19 22:22:32', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('ccea3291-a608-447b-87dc-b76f95465ebd', '9582769e-8ea6-4c5e-8397-4b5349f96209', 2260, 'S02212', 8124, 'Job Summaryc9159d93-af64-41c1-a040-939cbe418bb0.pdf', '{"items":[{"color":"Zalzach","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Zalzach 1mm\\nThickness : 1 mm\\nLength : 4355 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR115\\nClient Name :Optimized Sheets : 1\\nJob Reference : -Total Panels : 2\\nDate Required : 4/16/2026Job Wastage : 91.36 %\\nPhone Number :Job Cut Length : 11296 mm\\nFax Number :Unique Layouts : 1\\nCell No :Materials : 2\\nSheet Materials\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  11296 mm\\nMaterial Wastage :  91.36 %\\nArea :  0.257 m²\\nEdging Materials\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  4355 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR115
Client Name :Optimized Sheets : 1
Job Reference : -Total Panels : 2
Date Required : 4/16/2026Job Wastage : 91.36 %
Phone Number :Job Cut Length : 11296 mm
Fax Number :Unique Layouts : 1
Cell No :Materials : 2
Sheet Materials
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  11296 mm
Material Wastage :  91.36 %
Area :  0.257 m²
Edging Materials
Zalzach 1mm
Thickness :  1 mm
Length :  4355 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1', '2026-04-19 22:40:40', '144ed80c42bb11c954183eaa4fc011524cc969a9b1b4f135c17ddad807f76d7f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('33346017-0a76-4451-b161-c9b7fa3957f8', 'e75c06c3-7f3d-4421-a784-3b35100d8e5f', 2271, 'S02223', 8154, 'Job Summary92b91989-4df6-4b0b-af4d-500f29cce63f.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 24330 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR121\\nClient Name : VICTOROptimized Sheets : 4\\nJob Reference : -Total Panels : 11\\nDate Required : 4/18/2026Job Wastage : 28.02 %\\nPhone Number :Job Cut Length : 58922 mm\\nFax Number :Unique Layouts : 3\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  11\\nSheets :  4\\nMaterial Cut Length :  58922 mm\\nMaterial Wastage :  28.02 %\\nArea :  8.571 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  24330 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR121
Client Name : VICTOROptimized Sheets : 4
Job Reference : -Total Panels : 11
Date Required : 4/18/2026Job Wastage : 28.02 %
Phone Number :Job Cut Length : 58922 mm
Fax Number :Unique Layouts : 3
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  11
Sheets :  4
Material Cut Length :  58922 mm
Material Wastage :  28.02 %
Area :  8.571 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  24330 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1', '2026-04-20 00:36:33', '5f49a75a0b1ac3fb04089702530fdc53f6bbce9db857d66062bf7825825ab152');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('f4c4aae2-9397-4b9c-a220-5ba25583ac1a', '9d13dad5-4414-47d0-9ba8-47d66bba4630', 2219, 'S02171', 7961, 'Job Summary83d048c4-be0b-4e17-a852-557c57a8d0b0.pdf', '{"items":[{"color":"Darkwalnut","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Darkwalnut 1mm\\nThickness : 1 mm\\nLength : 16568 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 6884 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR94\\nClient Name : MARKOptimized Sheets : 2\\nJob Reference : -Total Panels : 18\\nDate Required : 4/10/2026Job Wastage : 36.38 %\\nPhone Number :Job Cut Length : 36115 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 4\\nSheet Materials\\nDARKWALNUT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  19979.5 mm\\nMaterial Wastage :  9.09 %\\nArea :  2.706 m²\\nWHITE MARBLE\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  8\\nSheets :  1\\nMaterial Cut Length :  16135.5 mm\\nMaterial Wastage :  63.68 %\\nArea :  1.081 m²\\nEdging Materials\\nDarkwalnut 1mm\\nThickness :  1 mm\\nLength :  16568 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  6884 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Darkwalnut 1mm\\".","Detected edging entry \\"White 1mm\\".","Extracted 2 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR94
Client Name : MARKOptimized Sheets : 2
Job Reference : -Total Panels : 18
Date Required : 4/10/2026Job Wastage : 36.38 %
Phone Number :Job Cut Length : 36115 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 4
Sheet Materials
DARKWALNUT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  19979.5 mm
Material Wastage :  9.09 %
Area :  2.706 m²
WHITE MARBLE
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  8
Sheets :  1
Material Cut Length :  16135.5 mm
Material Wastage :  63.68 %
Area :  1.081 m²
Edging Materials
Darkwalnut 1mm
Thickness :  1 mm
Length :  16568 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  6884 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page  1 of 1', '2026-04-20 00:39:09', '7a9ede3c66beb2cf4fece9ff127683905d60ac5007b7151efbca37d401c9357d');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('7edcf0be-2b82-417a-8131-0f0f175d848e', 'c51b397a-b644-46dc-9186-c65d98a68011', 2220, 'S02172', 7963, 'Job Summary5ffab86a-4b40-4984-91d1-fc673c1dc240.pdf', '{"items":[{"color":"Zalzach","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Zalzach 1mm\\nThickness : 1 mm\\nLength : 6690 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR96\\nClient Name : PAULOptimized Sheets : 1\\nJob Reference : -Total Panels : 2\\nDate Required : 4/10/2026Job Wastage : 74.36 %\\nPhone Number :Job Cut Length : 11396 mm\\nFax Number :Unique Layouts : 1\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  11396 mm\\nMaterial Wastage :  74.36 %\\nArea :  0.763 m²\\nEdging Materials\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  6690 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR96
Client Name : PAULOptimized Sheets : 1
Job Reference : -Total Panels : 2
Date Required : 4/10/2026Job Wastage : 74.36 %
Phone Number :Job Cut Length : 11396 mm
Fax Number :Unique Layouts : 1
Cell No : SHARONMaterials : 2
Sheet Materials
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  11396 mm
Material Wastage :  74.36 %
Area :  0.763 m²
Edging Materials
Zalzach 1mm
Thickness :  1 mm
Length :  6690 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/10/2026Page  1 of 1', '2026-04-20 00:42:49', '58b9675a7fb10fbbb132b543eaecbe4f06d65439d25168c9624a4b0482c7f807');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('7091ec0e-0e86-46fd-918b-54c74a87f0f7', '332b77ee-c992-4b03-807f-5d87ae8e9aa8', 1028, 'S01028', 8147, 'Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf', '{"items":[{"color":"Harbour Grey","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Harbour Grey 1mm\\nThickness : 1 mm\\nLength : 39522 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR121\\nClient Name : FREDRICK OTIENOOptimized Sheets : 3\\nJob Reference : -Total Panels : 36\\nDate Required : 4/18/2026Job Wastage : 8.18 %\\nPhone Number :Job Cut Length : 80521.5 mm\\nFax Number :Unique Layouts : 3\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nHARBOUR GREY WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  36\\nSheets :  3\\nMaterial Cut Length :  80521.5 mm\\nMaterial Wastage :  8.18 %\\nArea :  8.2 m²\\nEdging Materials\\nHarbour Grey 1mm\\nThickness :  1 mm\\nLength :  39522 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Harbour Grey 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR121
Client Name : FREDRICK OTIENOOptimized Sheets : 3
Job Reference : -Total Panels : 36
Date Required : 4/18/2026Job Wastage : 8.18 %
Phone Number :Job Cut Length : 80521.5 mm
Fax Number :Unique Layouts : 3
Cell No : SHARONMaterials : 2
Sheet Materials
HARBOUR GREY WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  36
Sheets :  3
Material Cut Length :  80521.5 mm
Material Wastage :  8.18 %
Area :  8.2 m²
Edging Materials
Harbour Grey 1mm
Thickness :  1 mm
Length :  39522 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1', '2026-04-20 00:43:46', '70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('c0268b9e-26ea-4345-9c0a-8ca0c3d2b615', '01cda4bb-6318-43be-9f2f-5e5a98278b5d', 1028, 'S01028', 8147, 'Job Summary69e3bd86-a177-45cd-8838-558e073dc819.pdf', '{"items":[{"color":"Harbour Grey","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Harbour Grey 1mm\\nThickness : 1 mm\\nLength : 39522 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR121\\nClient Name : FREDRICK OTIENOOptimized Sheets : 3\\nJob Reference : -Total Panels : 36\\nDate Required : 4/18/2026Job Wastage : 8.18 %\\nPhone Number :Job Cut Length : 80521.5 mm\\nFax Number :Unique Layouts : 3\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nHARBOUR GREY WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  36\\nSheets :  3\\nMaterial Cut Length :  80521.5 mm\\nMaterial Wastage :  8.18 %\\nArea :  8.2 m²\\nEdging Materials\\nHarbour Grey 1mm\\nThickness :  1 mm\\nLength :  39522 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Harbour Grey 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR121
Client Name : FREDRICK OTIENOOptimized Sheets : 3
Job Reference : -Total Panels : 36
Date Required : 4/18/2026Job Wastage : 8.18 %
Phone Number :Job Cut Length : 80521.5 mm
Fax Number :Unique Layouts : 3
Cell No : SHARONMaterials : 2
Sheet Materials
HARBOUR GREY WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  36
Sheets :  3
Material Cut Length :  80521.5 mm
Material Wastage :  8.18 %
Area :  8.2 m²
Edging Materials
Harbour Grey 1mm
Thickness :  1 mm
Length :  39522 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 1', '2026-04-20 00:55:34', '70b65936092469e838a728e1034b234cc91ef91dd17f361d4288e3cef3889739');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('5d509779-9f5a-4835-9ca9-6f7dc7a42126', '698a95b6-ae57-4bda-a747-643e345ea2e0', 2257, 'S02209', 8114, 'Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf', '{"items":[{"color":"Esperanza","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Esperanza 1mm\\nThickness : 1 mm\\nLength : 37006 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR118\\nClient Name : DAVEOptimized Sheets : 4\\nJob Reference : -Total Panels : 45\\nDate Required : 4/16/2026Job Wastage : 23.92 %\\nPhone Number :Job Cut Length : 75223.5 mm\\nFax Number :Unique Layouts : 4\\nCell No : SHARONMaterials : 4\\nSheet Materials\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  34\\nSheets :  2\\nMaterial Cut Length :  47253.5 mm\\nMaterial Wastage :  7.00 %\\nArea :  5.537 m²\\nHARBOUR GREY WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  5\\nSheets :  1\\nMaterial Cut Length :  12345 mm\\nMaterial Wastage :  71.08 %\\nArea :  0.861 m²\\nWHITE MARBLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  15625 mm\\nMaterial Wastage :  10.60 %\\nArea :  2.661 m²\\nEdging Materials\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  37006 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Esperanza 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR118
Client Name : DAVEOptimized Sheets : 4
Job Reference : -Total Panels : 45
Date Required : 4/16/2026Job Wastage : 23.92 %
Phone Number :Job Cut Length : 75223.5 mm
Fax Number :Unique Layouts : 4
Cell No : SHARONMaterials : 4
Sheet Materials
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  34
Sheets :  2
Material Cut Length :  47253.5 mm
Material Wastage :  7.00 %
Area :  5.537 m²
HARBOUR GREY WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  5
Sheets :  1
Material Cut Length :  12345 mm
Material Wastage :  71.08 %
Area :  0.861 m²
WHITE MARBLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  15625 mm
Material Wastage :  10.60 %
Area :  2.661 m²
Edging Materials
Esperanza 1mm
Thickness :  1 mm
Length :  37006 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page  1 of 1', '2026-04-20 04:03:25', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('bd817693-8be7-4018-a75d-845ad695954d', '42e1473b-90a1-4e97-842c-ddc6eddd2b38', 1016, 'S01016', 8199, 'Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf', '{"items":[{"color":"Light grey","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Light grey 1mm\\nThickness : 1 mm\\nLength : 68402 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR133\\nClient Name : FRANKOptimized Sheets : 10\\nJob Reference : -Total Panels : 61\\nDate Required : 4/21/2026Job Wastage : 18.45 %\\nPhone Number :Job Cut Length : 98206 mm\\nFax Number :Unique Layouts : 10\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  7\\nSheets :  3\\nMaterial Cut Length :  13990.5 mm\\nMaterial Wastage :  29.79 %\\nArea :  6.27 m²\\nLIGHT GREY\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  54\\nSheets :  7\\nMaterial Cut Length :  84215.5 mm\\nMaterial Wastage :  13.59 %\\nArea :  18.006 m²\\nEdging Materials\\nLight grey 1mm\\nThickness :  1 mm\\nLength :  68402 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Light grey 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR133
Client Name : FRANKOptimized Sheets : 10
Job Reference : -Total Panels : 61
Date Required : 4/21/2026Job Wastage : 18.45 %
Phone Number :Job Cut Length : 98206 mm
Fax Number :Unique Layouts : 10
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  7
Sheets :  3
Material Cut Length :  13990.5 mm
Material Wastage :  29.79 %
Area :  6.27 m²
LIGHT GREY
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  54
Sheets :  7
Material Cut Length :  84215.5 mm
Material Wastage :  13.59 %
Area :  18.006 m²
Edging Materials
Light grey 1mm
Thickness :  1 mm
Length :  68402 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page  1 of 1', '2026-04-21 23:30:25', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('04822cf4-ee38-4b24-910b-f5a8af3b504c', 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-23 12:57:34', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('3e3a7954-7dfd-4f41-a3ae-4dddc87ff597', 'c52ea6a3-4127-4eb7-825f-8a866562bd16', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 43642 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR135\\nClient Name : PETER MZENGEOptimized Sheets : 4\\nJob Reference : -Total Panels : 11\\nDate Required : 4/22/2026Job Wastage : 21.91 %\\nPhone Number :Job Cut Length : 53264.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  11\\nSheets :  4\\nMaterial Cut Length :  53264.5 mm\\nMaterial Wastage :  21.91 %\\nArea :  9.298 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  43642 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR135
Client Name : PETER MZENGEOptimized Sheets : 4
Job Reference : -Total Panels : 11
Date Required : 4/22/2026Job Wastage : 21.91 %
Phone Number :Job Cut Length : 53264.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  11
Sheets :  4
Material Cut Length :  53264.5 mm
Material Wastage :  21.91 %
Area :  9.298 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  43642 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1', '2026-04-23 15:10:03', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('671323e0-b021-40ed-8ab0-034ace97d124', '8e055e9d-ba32-48ae-80b9-36693470612b', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Detected edging entry \\"Esperanza 1mm\\".","Detected edging entry \\"Neuro 1mm\\".","Detected edging entry \\"White 1mm\\".","Detected edging entry \\"White Marble 1mm\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-23 15:49:57', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('995a0476-f460-4453-ab04-82f8bba3ba03', 'ccfd173d-8e61-49b7-8d04-41409206183b', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 43642 mm\\nRoll\\nLength : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR135\\nClient Name : PETER MZENGEOptimized Sheets : 4\\nJob Reference : -Total Panels : 11\\nDate Required : 4/22/2026Job Wastage : 21.91 %\\nPhone Number :Job Cut Length : 53264.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  11\\nSheets :  4\\nMaterial Cut Length :  53264.5 mm\\nMaterial Wastage :  21.91 %\\nArea :  9.298 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  43642 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR135
Client Name : PETER MZENGEOptimized Sheets : 4
Job Reference : -Total Panels : 11
Date Required : 4/22/2026Job Wastage : 21.91 %
Phone Number :Job Cut Length : 53264.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  11
Sheets :  4
Material Cut Length :  53264.5 mm
Material Wastage :  21.91 %
Area :  9.298 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  43642 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1', '2026-04-23 19:35:56', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('4f216840-0a0e-4f4b-b6d8-fac11809a966', '26fb5937-ef5e-4562-9b02-602cb6844bad', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":null,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Detected edging entry \\"Esperanza 1mm\\".","Detected edging entry \\"Neuro 1mm\\".","Detected edging entry \\"White 1mm\\".","Detected edging entry \\"White Marble 1mm\\".","Detected edging entry \\"Zalzach 1mm\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-23 21:22:27', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('f57a5f23-7a79-49a1-b856-d96a5ef179fa', 'd5ba4106-4f29-4c60-99f0-4084151c2a08', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":null,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-23 22:22:34', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('5504c66e-9ec2-4d2f-8dbe-b10e81fa1afd', '2c1e0bb9-7078-4051-9c88-d6d4064b78e8', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":null,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-23 22:32:23', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('620b6f08-22fb-4e3f-8cc0-7c868913596a', 'f82dc724-b182-4b9f-a555-f8220c1af598', 2257, 'S02209', 8114, 'Job Summary219a57a5-b446-4974-89bf-622516428ff2.pdf', '{"items":[{"color":"Esperanza","thickness_mm":null,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Esperanza 1mm\\nThickness : 1 mm\\nLength : 37006 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR118\\nClient Name : DAVEOptimized Sheets : 4\\nJob Reference : -Total Panels : 45\\nDate Required : 4/16/2026Job Wastage : 23.92 %\\nPhone Number :Job Cut Length : 75223.5 mm\\nFax Number :Unique Layouts : 4\\nCell No : SHARONMaterials : 4\\nSheet Materials\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  34\\nSheets :  2\\nMaterial Cut Length :  47253.5 mm\\nMaterial Wastage :  7.00 %\\nArea :  5.537 m²\\nHARBOUR GREY WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  5\\nSheets :  1\\nMaterial Cut Length :  12345 mm\\nMaterial Wastage :  71.08 %\\nArea :  0.861 m²\\nWHITE MARBLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  15625 mm\\nMaterial Wastage :  10.60 %\\nArea :  2.661 m²\\nEdging Materials\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  37006 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"37006 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR118
Client Name : DAVEOptimized Sheets : 4
Job Reference : -Total Panels : 45
Date Required : 4/16/2026Job Wastage : 23.92 %
Phone Number :Job Cut Length : 75223.5 mm
Fax Number :Unique Layouts : 4
Cell No : SHARONMaterials : 4
Sheet Materials
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  34
Sheets :  2
Material Cut Length :  47253.5 mm
Material Wastage :  7.00 %
Area :  5.537 m²
HARBOUR GREY WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  5
Sheets :  1
Material Cut Length :  12345 mm
Material Wastage :  71.08 %
Area :  0.861 m²
WHITE MARBLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  15625 mm
Material Wastage :  10.60 %
Area :  2.661 m²
Edging Materials
Esperanza 1mm
Thickness :  1 mm
Length :  37006 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/16/2026Page  1 of 1', '2026-04-23 22:41:29', '5d0746d986606f207cb3ee3fa3daf5621e31481cf81ac084f7974c8b3a098dc0');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('65353d37-cfbe-4595-80cb-c0534b78e533', 'a5acbfd2-b9c8-4ec7-922f-ceea67d42f53', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":null,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":null,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":null,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured length \\"133928 mm\\" for \\"Caraz\\".","Captured length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured length \\"149330 mm\\" for \\"Esperanza\\".","Captured length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured length \\"29828 mm\\" for \\"Neuro\\".","Captured length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured length \\"220028 mm\\" for \\"White\\".","Captured length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured length \\"23000 mm\\" for \\"White Marble\\".","Captured length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured length \\"43360 mm\\" for \\"Zalzach\\".","Captured length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-24 07:40:42', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('8e46e267-3686-47ec-8ade-3c9f19aa8f13', '77c761f2-fa7e-4ff7-8aa3-f61b1656f998', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Esperanza","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Neuro","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White","thickness_mm":1,"length_mm":15000,"roll_length_mm":null},{"color":"White Marble","thickness_mm":1,"length_mm":150000,"roll_length_mm":null},{"color":"Zalzach","thickness_mm":1,"length_mm":150000,"roll_length_mm":null}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll\\nLength : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll\\nLength : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll\\nLength : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll\\nLength : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll\\nLength : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll\\nLength : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured used length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured used length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured used length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured used length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured used length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured used length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-24 07:57:34', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('2aafadf9-c0c2-488e-8fe6-f55b4c2d7fb8', 'e400cde1-1a87-44da-a20b-39cc32e18957', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":1,"length_mm":133928,"roll_length_mm":150000},{"color":"Esperanza","thickness_mm":1,"length_mm":149330,"roll_length_mm":150000},{"color":"Neuro","thickness_mm":1,"length_mm":29828,"roll_length_mm":15000},{"color":"White","thickness_mm":1,"length_mm":220028,"roll_length_mm":15000},{"color":"White Marble","thickness_mm":1,"length_mm":23000,"roll_length_mm":150000},{"color":"Zalzach","thickness_mm":1,"length_mm":43360,"roll_length_mm":150000}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll Length : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll Length : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll Length : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll Length : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll Length : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll Length : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured roll length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured roll length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured roll length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured roll length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured roll length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-24 09:27:05', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('0d1bdc67-26bf-4a69-b619-855a12a02985', 'cd9f5c84-7f81-4174-bba9-b030c253ced1', 2266, 'S02218', 8149, 'Job Summaryc8026087-c2d0-4314-b585-03741b1a892a.pdf', '{"items":[{"color":"Caraz","thickness_mm":1,"length_mm":133928,"roll_length_mm":150000},{"color":"Esperanza","thickness_mm":1,"length_mm":149330,"roll_length_mm":150000},{"color":"Neuro","thickness_mm":1,"length_mm":29828,"roll_length_mm":15000},{"color":"White","thickness_mm":1,"length_mm":220028,"roll_length_mm":15000},{"color":"White Marble","thickness_mm":1,"length_mm":23000,"roll_length_mm":150000},{"color":"Zalzach","thickness_mm":1,"length_mm":43360,"roll_length_mm":150000}],"sectionFound":true,"sectionText":"Caraz 1mm\\nThickness : 1 mm\\nLength : 133928 mm\\nRoll Length : 150000 mm\\nEsperanza 1mm\\nThickness : 1 mm\\nLength : 149330 mm\\nRoll Length : 150000 mm\\nNeuro 1mm\\nThickness : 1 mm\\nLength : 29828 mm\\nRoll Length : 15000 mm\\nWhite 1mm\\nThickness : 1 mm\\nLength : 220028 mm\\nRoll Length : 15000 mm\\nWhite Marble 1mm\\nThickness : 1 mm\\nLength : 23000 mm\\nRoll Length : 150000 mm\\nZalzach 1mm\\nThickness : 1 mm\\nLength : 43360 mm\\nRoll Length : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR119\\nClient Name : MWANGIOptimized Sheets : 52\\nJob Reference : -Total Panels : 392\\nDate Required : 4/17/2026Job Wastage : 13.89 %\\nPhone Number :Job Cut Length : 931528 mm\\nFax Number :Unique Layouts : 44\\nCell No : SHARONMaterials : 12\\nSheet Materials\\nCARAZ PARTICLE {GREEN} 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  72\\nSheets :  5\\nMaterial Cut Length :  139258.5 mm\\nMaterial Wastage :  5.68 %\\nArea :  23.798 m²\\nESPERANZA\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  109\\nSheets :  12\\nMaterial Cut Length :  218205 mm\\nMaterial Wastage :  13.89 %\\nArea :  30.76 m²\\nNEURO\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  23\\nSheets :  5\\nMaterial Cut Length :  73315 mm\\nMaterial Wastage :  11.42 %\\nArea :  13.184 m²\\nWHITE MARBLE PARTICLE 9*6FT\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2750 mm\\nSheet Width :  1835 mm\\nMaterial Panels :  3\\nSheets :  3\\nMaterial Cut Length :  39288 mm\\nMaterial Wastage :  37.38 %\\nArea :  9.48 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2\\n\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  170\\nSheets :  23\\nMaterial Cut Length :  403585.5 mm\\nMaterial Wastage :  9.98 %\\nArea :  61.631 m²\\nZALZACH\\nHas Grain :  Yes\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  15\\nSheets :  4\\nMaterial Cut Length :  57876 mm\\nMaterial Wastage :  26.96 %\\nArea :  8.697 m²\\nEdging Materials\\nCaraz 1mm\\nThickness :  1 mm\\nLength :  133928 mm\\nRoll Length :  150000 mm\\nEsperanza 1mm\\nThickness :  1 mm\\nLength :  149330 mm\\nRoll Length :  150000 mm\\nNeuro 1mm\\nThickness :  1 mm\\nLength :  29828 mm\\nRoll Length :  15000 mm\\nWhite 1mm\\nThickness :  1 mm\\nLength :  220028 mm\\nRoll Length :  15000 mm\\nWhite Marble 1mm\\nThickness :  1 mm\\nLength :  23000 mm\\nRoll Length :  150000 mm\\nZalzach 1mm\\nThickness :  1 mm\\nLength :  43360 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Caraz 1mm\\".","Captured thickness \\"1 mm\\" for \\"Caraz\\".","Captured used length \\"133928 mm\\" for \\"Caraz\\".","Captured roll length \\"150000 mm\\" for \\"Caraz\\".","Detected edging entry \\"Esperanza 1mm\\".","Captured thickness \\"1 mm\\" for \\"Esperanza\\".","Captured used length \\"149330 mm\\" for \\"Esperanza\\".","Captured roll length \\"150000 mm\\" for \\"Esperanza\\".","Detected edging entry \\"Neuro 1mm\\".","Captured thickness \\"1 mm\\" for \\"Neuro\\".","Captured used length \\"29828 mm\\" for \\"Neuro\\".","Captured roll length \\"15000 mm\\" for \\"Neuro\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"220028 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Detected edging entry \\"White Marble 1mm\\".","Captured thickness \\"1 mm\\" for \\"White Marble\\".","Captured used length \\"23000 mm\\" for \\"White Marble\\".","Captured roll length \\"150000 mm\\" for \\"White Marble\\".","Detected edging entry \\"Zalzach 1mm\\".","Captured thickness \\"1 mm\\" for \\"Zalzach\\".","Captured used length \\"43360 mm\\" for \\"Zalzach\\".","Captured roll length \\"150000 mm\\" for \\"Zalzach\\".","Extracted 6 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR119
Client Name : MWANGIOptimized Sheets : 52
Job Reference : -Total Panels : 392
Date Required : 4/17/2026Job Wastage : 13.89 %
Phone Number :Job Cut Length : 931528 mm
Fax Number :Unique Layouts : 44
Cell No : SHARONMaterials : 12
Sheet Materials
CARAZ PARTICLE {GREEN} 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  72
Sheets :  5
Material Cut Length :  139258.5 mm
Material Wastage :  5.68 %
Area :  23.798 m²
ESPERANZA
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  109
Sheets :  12
Material Cut Length :  218205 mm
Material Wastage :  13.89 %
Area :  30.76 m²
NEURO
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  23
Sheets :  5
Material Cut Length :  73315 mm
Material Wastage :  11.42 %
Area :  13.184 m²
WHITE MARBLE PARTICLE 9*6FT
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2750 mm
Sheet Width :  1835 mm
Material Panels :  3
Sheets :  3
Material Cut Length :  39288 mm
Material Wastage :  37.38 %
Area :  9.48 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  1 of 2

WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  170
Sheets :  23
Material Cut Length :  403585.5 mm
Material Wastage :  9.98 %
Area :  61.631 m²
ZALZACH
Has Grain :  Yes
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  15
Sheets :  4
Material Cut Length :  57876 mm
Material Wastage :  26.96 %
Area :  8.697 m²
Edging Materials
Caraz 1mm
Thickness :  1 mm
Length :  133928 mm
Roll Length :  150000 mm
Esperanza 1mm
Thickness :  1 mm
Length :  149330 mm
Roll Length :  150000 mm
Neuro 1mm
Thickness :  1 mm
Length :  29828 mm
Roll Length :  15000 mm
White 1mm
Thickness :  1 mm
Length :  220028 mm
Roll Length :  15000 mm
White Marble 1mm
Thickness :  1 mm
Length :  23000 mm
Roll Length :  150000 mm
Zalzach 1mm
Thickness :  1 mm
Length :  43360 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/18/2026Page  2 of 2', '2026-04-24 09:56:41', '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('38c51bbd-db52-4359-bb49-58e878cd8001', '82075034-4257-4ac4-9cd5-4d98a79c525e', 2263, 'S02215', 8129, 'Job Summary17ab2700-6e55-4aac-a5d6-876150ee21a0.pdf', '{"items":[{"color":"Cappuccino","thickness_mm":1,"length_mm":2800,"roll_length_mm":150000}],"sectionFound":true,"sectionText":"Cappuccino 1mm\\nThickness : 1 mm\\nLength : 2800 mm\\nRoll Length : 150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR117\\nClient Name : ALPHAYOOptimized Sheets : 1\\nJob Reference : -Total Panels : 2\\nDate Required : 4/17/2026Job Wastage : 91.77 %\\nPhone Number :Job Cut Length : 9216 mm\\nFax Number :Unique Layouts : 1\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nCAPPUCCINO PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  9216 mm\\nMaterial Wastage :  91.77 %\\nArea :  0.245 m²\\nEdging Materials\\nCappuccino 1mm\\nThickness :  1 mm\\nLength :  2800 mm\\nRoll Length :  150000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Cappuccino 1mm\\".","Captured thickness \\"1 mm\\" for \\"Cappuccino\\".","Captured used length \\"2800 mm\\" for \\"Cappuccino\\".","Captured roll length \\"150000 mm\\" for \\"Cappuccino\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR117
Client Name : ALPHAYOOptimized Sheets : 1
Job Reference : -Total Panels : 2
Date Required : 4/17/2026Job Wastage : 91.77 %
Phone Number :Job Cut Length : 9216 mm
Fax Number :Unique Layouts : 1
Cell No : SHARONMaterials : 2
Sheet Materials
CAPPUCCINO PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  9216 mm
Material Wastage :  91.77 %
Area :  0.245 m²
Edging Materials
Cappuccino 1mm
Thickness :  1 mm
Length :  2800 mm
Roll Length :  150000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1', '2026-04-24 10:26:09', 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('bce54459-5ec4-409f-b460-20d27d078d3e', '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', 2261, 'S02213', 8122, 'Job Summary67056039-778d-4133-878d-b5176ba8b0f4.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":15528,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 15528 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR116\\nClient Name : FREDRICK OUMAOptimized Sheets : 2\\nJob Reference : -Total Panels : 8\\nDate Required : 4/17/2026Job Wastage : 53.55 %\\nPhone Number :Job Cut Length : 28228 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  8\\nSheets :  2\\nMaterial Cut Length :  28228 mm\\nMaterial Wastage :  53.55 %\\nArea :  2.766 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  15528 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"15528 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR116
Client Name : FREDRICK OUMAOptimized Sheets : 2
Job Reference : -Total Panels : 8
Date Required : 4/17/2026Job Wastage : 53.55 %
Phone Number :Job Cut Length : 28228 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  8
Sheets :  2
Material Cut Length :  28228 mm
Material Wastage :  53.55 %
Area :  2.766 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  15528 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/17/2026Page  1 of 1', '2026-04-24 10:27:35', '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('7616c982-1873-4817-83d4-e26b87e7d9a9', '459f91e2-0023-4e72-9613-f7b94c36c750', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-24 10:47:48', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('386b4ab6-3875-4ee9-a520-10c40cfc7437', '0b109b08-351e-4663-a8f2-e0d57b0d1fe0', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":171223,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 171223 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : VINCENT NAMBANGAOptimized Sheets : 17\\nJob Reference : -Total Panels : 129\\nDate Required : 4/23/2026Job Wastage : 15.96 %\\nPhone Number :Job Cut Length : 285017.5 mm\\nFax Number :Unique Layouts : 16\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  25\\nSheets :  7\\nMaterial Cut Length :  90149 mm\\nMaterial Wastage :  32.53 %\\nArea :  14.06 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  104\\nSheets :  10\\nMaterial Cut Length :  194868.5 mm\\nMaterial Wastage :  4.36 %\\nArea :  28.469 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  171223 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : VINCENT NAMBANGAOptimized Sheets : 17
Job Reference : -Total Panels : 129
Date Required : 4/23/2026Job Wastage : 15.96 %
Phone Number :Job Cut Length : 285017.5 mm
Fax Number :Unique Layouts : 16
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  25
Sheets :  7
Material Cut Length :  90149 mm
Material Wastage :  32.53 %
Area :  14.06 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  104
Sheets :  10
Material Cut Length :  194868.5 mm
Material Wastage :  4.36 %
Area :  28.469 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  171223 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 22:11:25', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('9a9ace69-0412-4b1c-9e8c-5e04dd80962f', 'eff11008-3801-4cf2-9724-1c2a87512d8d', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":9140,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 9140 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR142\\nClient Name : FARAOHOptimized Sheets : 2\\nJob Reference : -Total Panels : 19\\nDate Required : 4/24/2026Job Wastage : 61.73 %\\nPhone Number :Job Cut Length : 30734.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  17\\nSheets :  1\\nMaterial Cut Length :  20690.5 mm\\nMaterial Wastage :  51.17 %\\nArea :  1.453 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  10044 mm\\nMaterial Wastage :  72.28 %\\nArea :  0.825 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  9140 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR142
Client Name : FARAOHOptimized Sheets : 2
Job Reference : -Total Panels : 19
Date Required : 4/24/2026Job Wastage : 61.73 %
Phone Number :Job Cut Length : 30734.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 3
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  17
Sheets :  1
Material Cut Length :  20690.5 mm
Material Wastage :  51.17 %
Area :  1.453 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  10044 mm
Material Wastage :  72.28 %
Area :  0.825 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  9140 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 22:13:28', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('1dd5f134-a34a-4ad0-8314-c885e819e549', '8081dd95-6019-4c55-bfd6-7b6e4ab806d0', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-24 22:40:45', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('611fb6cb-f628-430a-b8c5-ddacde9d2430', '98a3b523-1432-4be1-9dfa-e44d84699b28', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":9140,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 9140 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR142\\nClient Name : FARAOHOptimized Sheets : 2\\nJob Reference : -Total Panels : 19\\nDate Required : 4/24/2026Job Wastage : 61.73 %\\nPhone Number :Job Cut Length : 30734.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  17\\nSheets :  1\\nMaterial Cut Length :  20690.5 mm\\nMaterial Wastage :  51.17 %\\nArea :  1.453 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  10044 mm\\nMaterial Wastage :  72.28 %\\nArea :  0.825 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  9140 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR142
Client Name : FARAOHOptimized Sheets : 2
Job Reference : -Total Panels : 19
Date Required : 4/24/2026Job Wastage : 61.73 %
Phone Number :Job Cut Length : 30734.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 3
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  17
Sheets :  1
Material Cut Length :  20690.5 mm
Material Wastage :  51.17 %
Area :  1.453 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  10044 mm
Material Wastage :  72.28 %
Area :  0.825 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  9140 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:46:20', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('372a9293-e5c4-4389-b148-d91b6ba4e6b6', '77eb90b1-2acf-44fb-bc34-0ecf6ea24198', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":171223,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 171223 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : VINCENT NAMBANGAOptimized Sheets : 17\\nJob Reference : -Total Panels : 129\\nDate Required : 4/23/2026Job Wastage : 15.96 %\\nPhone Number :Job Cut Length : 285017.5 mm\\nFax Number :Unique Layouts : 16\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  25\\nSheets :  7\\nMaterial Cut Length :  90149 mm\\nMaterial Wastage :  32.53 %\\nArea :  14.06 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  104\\nSheets :  10\\nMaterial Cut Length :  194868.5 mm\\nMaterial Wastage :  4.36 %\\nArea :  28.469 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  171223 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : VINCENT NAMBANGAOptimized Sheets : 17
Job Reference : -Total Panels : 129
Date Required : 4/23/2026Job Wastage : 15.96 %
Phone Number :Job Cut Length : 285017.5 mm
Fax Number :Unique Layouts : 16
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  25
Sheets :  7
Material Cut Length :  90149 mm
Material Wastage :  32.53 %
Area :  14.06 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  104
Sheets :  10
Material Cut Length :  194868.5 mm
Material Wastage :  4.36 %
Area :  28.469 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  171223 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:46:38', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('9581920a-abd8-4034-9ee4-6bf8af213406', 'b70aceb8-03b5-4719-b9f2-78064e112f49', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-24 23:47:00', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('ed697349-b7f6-486f-bafd-868f1ec71b0b', 'dc26c861-11de-4186-9943-ed25c0efc705', 2291, 'S02243', 8235, 'Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":43642,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 43642 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR135\\nClient Name : PETER MZENGEOptimized Sheets : 4\\nJob Reference : -Total Panels : 11\\nDate Required : 4/22/2026Job Wastage : 21.91 %\\nPhone Number :Job Cut Length : 53264.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 2\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  11\\nSheets :  4\\nMaterial Cut Length :  53264.5 mm\\nMaterial Wastage :  21.91 %\\nArea :  9.298 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  43642 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"43642 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR135
Client Name : PETER MZENGEOptimized Sheets : 4
Job Reference : -Total Panels : 11
Date Required : 4/22/2026Job Wastage : 21.91 %
Phone Number :Job Cut Length : 53264.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 2
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  11
Sheets :  4
Material Cut Length :  53264.5 mm
Material Wastage :  21.91 %
Area :  9.298 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  43642 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 1', '2026-04-24 23:47:21', '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('3bd53e0c-1a15-4843-ad9a-95033aacaad1', 'ddc3558c-cbb5-4f50-801c-80f50f4f4a17', 1016, 'S01016', 8199, 'Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf', '{"items":[{"color":"Light grey","thickness_mm":1,"length_mm":68402,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Light grey 1mm\\nThickness : 1 mm\\nLength : 68402 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR133\\nClient Name : FRANKOptimized Sheets : 10\\nJob Reference : -Total Panels : 61\\nDate Required : 4/21/2026Job Wastage : 18.45 %\\nPhone Number :Job Cut Length : 98206 mm\\nFax Number :Unique Layouts : 10\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  7\\nSheets :  3\\nMaterial Cut Length :  13990.5 mm\\nMaterial Wastage :  29.79 %\\nArea :  6.27 m²\\nLIGHT GREY\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  54\\nSheets :  7\\nMaterial Cut Length :  84215.5 mm\\nMaterial Wastage :  13.59 %\\nArea :  18.006 m²\\nEdging Materials\\nLight grey 1mm\\nThickness :  1 mm\\nLength :  68402 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Light grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Light grey\\".","Captured used length \\"68402 mm\\" for \\"Light grey\\".","Captured roll length \\"15000 mm\\" for \\"Light grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR133
Client Name : FRANKOptimized Sheets : 10
Job Reference : -Total Panels : 61
Date Required : 4/21/2026Job Wastage : 18.45 %
Phone Number :Job Cut Length : 98206 mm
Fax Number :Unique Layouts : 10
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  7
Sheets :  3
Material Cut Length :  13990.5 mm
Material Wastage :  29.79 %
Area :  6.27 m²
LIGHT GREY
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  54
Sheets :  7
Material Cut Length :  84215.5 mm
Material Wastage :  13.59 %
Area :  18.006 m²
Edging Materials
Light grey 1mm
Thickness :  1 mm
Length :  68402 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/21/2026Page  1 of 1', '2026-04-24 23:47:41', 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('c735575d-b7e8-43be-955c-6c04b51e16a6', '714642d5-4301-4ee6-8e1b-356512ecf582', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":9140,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 9140 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR142\\nClient Name : FARAOHOptimized Sheets : 2\\nJob Reference : -Total Panels : 19\\nDate Required : 4/24/2026Job Wastage : 61.73 %\\nPhone Number :Job Cut Length : 30734.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  17\\nSheets :  1\\nMaterial Cut Length :  20690.5 mm\\nMaterial Wastage :  51.17 %\\nArea :  1.453 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  10044 mm\\nMaterial Wastage :  72.28 %\\nArea :  0.825 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  9140 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR142
Client Name : FARAOHOptimized Sheets : 2
Job Reference : -Total Panels : 19
Date Required : 4/24/2026Job Wastage : 61.73 %
Phone Number :Job Cut Length : 30734.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 3
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  17
Sheets :  1
Material Cut Length :  20690.5 mm
Material Wastage :  51.17 %
Area :  1.453 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  10044 mm
Material Wastage :  72.28 %
Area :  0.825 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  9140 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:55:55', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('8dfe88c1-0b80-40e5-ae94-eebb23aa0fa4', '42944f08-cd7d-42ce-b047-0dbac7967bd3', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":171223,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 171223 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : VINCENT NAMBANGAOptimized Sheets : 17\\nJob Reference : -Total Panels : 129\\nDate Required : 4/23/2026Job Wastage : 15.96 %\\nPhone Number :Job Cut Length : 285017.5 mm\\nFax Number :Unique Layouts : 16\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  25\\nSheets :  7\\nMaterial Cut Length :  90149 mm\\nMaterial Wastage :  32.53 %\\nArea :  14.06 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  104\\nSheets :  10\\nMaterial Cut Length :  194868.5 mm\\nMaterial Wastage :  4.36 %\\nArea :  28.469 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  171223 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : VINCENT NAMBANGAOptimized Sheets : 17
Job Reference : -Total Panels : 129
Date Required : 4/23/2026Job Wastage : 15.96 %
Phone Number :Job Cut Length : 285017.5 mm
Fax Number :Unique Layouts : 16
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  25
Sheets :  7
Material Cut Length :  90149 mm
Material Wastage :  32.53 %
Area :  14.06 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  104
Sheets :  10
Material Cut Length :  194868.5 mm
Material Wastage :  4.36 %
Area :  28.469 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  171223 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:56:04', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('636876c7-44c5-429d-9188-547eeb17aaae', '74474ad4-530f-4d79-a62c-fb40b279afab', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-24 23:56:17', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('25be761b-412f-4e09-b1b0-2a57512ed5aa', '7548e2d9-4129-4028-881d-8deacd2df6b4', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":9140,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 9140 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR142\\nClient Name : FARAOHOptimized Sheets : 2\\nJob Reference : -Total Panels : 19\\nDate Required : 4/24/2026Job Wastage : 61.73 %\\nPhone Number :Job Cut Length : 30734.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  17\\nSheets :  1\\nMaterial Cut Length :  20690.5 mm\\nMaterial Wastage :  51.17 %\\nArea :  1.453 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  10044 mm\\nMaterial Wastage :  72.28 %\\nArea :  0.825 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  9140 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR142
Client Name : FARAOHOptimized Sheets : 2
Job Reference : -Total Panels : 19
Date Required : 4/24/2026Job Wastage : 61.73 %
Phone Number :Job Cut Length : 30734.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 3
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  17
Sheets :  1
Material Cut Length :  20690.5 mm
Material Wastage :  51.17 %
Area :  1.453 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  10044 mm
Material Wastage :  72.28 %
Area :  0.825 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  9140 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:57:15', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('51d24ca3-5dbf-4264-a6cc-8c44d6164f67', '23312e8b-8a72-43c3-9c6f-003699abdd58', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":171223,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 171223 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : VINCENT NAMBANGAOptimized Sheets : 17\\nJob Reference : -Total Panels : 129\\nDate Required : 4/23/2026Job Wastage : 15.96 %\\nPhone Number :Job Cut Length : 285017.5 mm\\nFax Number :Unique Layouts : 16\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  25\\nSheets :  7\\nMaterial Cut Length :  90149 mm\\nMaterial Wastage :  32.53 %\\nArea :  14.06 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  104\\nSheets :  10\\nMaterial Cut Length :  194868.5 mm\\nMaterial Wastage :  4.36 %\\nArea :  28.469 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  171223 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : VINCENT NAMBANGAOptimized Sheets : 17
Job Reference : -Total Panels : 129
Date Required : 4/23/2026Job Wastage : 15.96 %
Phone Number :Job Cut Length : 285017.5 mm
Fax Number :Unique Layouts : 16
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  25
Sheets :  7
Material Cut Length :  90149 mm
Material Wastage :  32.53 %
Area :  14.06 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  104
Sheets :  10
Material Cut Length :  194868.5 mm
Material Wastage :  4.36 %
Area :  28.469 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  171223 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:57:26', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('7c6c3e4f-9daa-4272-82f4-18b62e5079c0', '067dfd4d-f412-4962-973a-b5b9e69b190b', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-24 23:57:42', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('7fa3fb0f-5554-48c8-b179-8390cd82d475', '7bbb6d48-a21a-46c3-bf86-eb339439f0d3', 2302, 'S02254', 8256, 'Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":9140,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 9140 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR142\\nClient Name : FARAOHOptimized Sheets : 2\\nJob Reference : -Total Panels : 19\\nDate Required : 4/24/2026Job Wastage : 61.73 %\\nPhone Number :Job Cut Length : 30734.5 mm\\nFax Number :Unique Layouts : 2\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  17\\nSheets :  1\\nMaterial Cut Length :  20690.5 mm\\nMaterial Wastage :  51.17 %\\nArea :  1.453 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  2\\nSheets :  1\\nMaterial Cut Length :  10044 mm\\nMaterial Wastage :  72.28 %\\nArea :  0.825 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  9140 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"9140 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR142
Client Name : FARAOHOptimized Sheets : 2
Job Reference : -Total Panels : 19
Date Required : 4/24/2026Job Wastage : 61.73 %
Phone Number :Job Cut Length : 30734.5 mm
Fax Number :Unique Layouts : 2
Cell No : SHARONMaterials : 3
Sheet Materials
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  17
Sheets :  1
Material Cut Length :  20690.5 mm
Material Wastage :  51.17 %
Area :  1.453 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  2
Sheets :  1
Material Cut Length :  10044 mm
Material Wastage :  72.28 %
Area :  0.825 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  9140 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:59:15', 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('d4d7277e-5b37-4b71-8f47-4707aaa3e2ae', '486dbc32-2472-4acd-b64b-501909f60ce3', 2298, 'S02250', 8254, 'Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf', '{"items":[{"color":"White","thickness_mm":1,"length_mm":171223,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"White 1mm\\nThickness : 1 mm\\nLength : 171223 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page 1 of 1","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : VINCENT NAMBANGAOptimized Sheets : 17\\nJob Reference : -Total Panels : 129\\nDate Required : 4/23/2026Job Wastage : 15.96 %\\nPhone Number :Job Cut Length : 285017.5 mm\\nFax Number :Unique Layouts : 16\\nCell No : SHARONMaterials : 3\\nSheet Materials\\nBACKER WHITE\\nHas Grain :  No\\nThickness :  3 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  25\\nSheets :  7\\nMaterial Cut Length :  90149 mm\\nMaterial Wastage :  32.53 %\\nArea :  14.06 m²\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  104\\nSheets :  10\\nMaterial Cut Length :  194868.5 mm\\nMaterial Wastage :  4.36 %\\nArea :  28.469 m²\\nEdging Materials\\nWhite 1mm\\nThickness :  1 mm\\nLength :  171223 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"White 1mm\\".","Captured thickness \\"1 mm\\" for \\"White\\".","Captured used length \\"171223 mm\\" for \\"White\\".","Captured roll length \\"15000 mm\\" for \\"White\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : VINCENT NAMBANGAOptimized Sheets : 17
Job Reference : -Total Panels : 129
Date Required : 4/23/2026Job Wastage : 15.96 %
Phone Number :Job Cut Length : 285017.5 mm
Fax Number :Unique Layouts : 16
Cell No : SHARONMaterials : 3
Sheet Materials
BACKER WHITE
Has Grain :  No
Thickness :  3 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  25
Sheets :  7
Material Cut Length :  90149 mm
Material Wastage :  32.53 %
Area :  14.06 m²
WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  104
Sheets :  10
Material Cut Length :  194868.5 mm
Material Wastage :  4.36 %
Area :  28.469 m²
Edging Materials
White 1mm
Thickness :  1 mm
Length :  171223 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/24/2026Page  1 of 1', '2026-04-24 23:59:35', 'ebd472e53400cd72e440699366f79c77716b3bf4dfb3cea40b6000398326da4f');
INSERT INTO `extracted_results` (`id`, `history_id`, `order_id`, `order_name`, `attachment_id`, `attachment_name`, `result_json`, `raw_text`, `created_at`, `pdf_signature`) VALUES ('4813a88f-1ba3-41aa-a7c5-96ece39c8833', 'ffeeaa85-9164-4688-a64d-fdca984a2751', 2296, 'S02248', 8242, 'Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf', '{"items":[{"color":"Dark grey","thickness_mm":1,"length_mm":99147,"roll_length_mm":15000}],"sectionFound":true,"sectionText":"Dark grey 1mm\\nThickness : 1 mm\\nLength : 99147 mm\\nRoll Length : 15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page 2 of 2","rawText":"\\n\\nJob Summary - URBAN VIBE INTERIOR137\\nClient Name : FARAOHOptimized Sheets : 12\\nJob Reference : -Total Panels : 114\\nDate Required : 4/23/2026Job Wastage : 27.17 %\\nPhone Number :Job Cut Length : 238436 mm\\nFax Number :Unique Layouts : 12\\nCell No : SHARONMaterials : 6\\nSheet Materials\\nBLOCK BOARD\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  10\\nSheets :  1\\nMaterial Cut Length :  31937.5 mm\\nMaterial Wastage :  75.51 %\\nArea :  0.729 m²\\nDARK GREY PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  22\\nSheets :  3\\nMaterial Cut Length :  48551 mm\\nMaterial Wastage :  19.65 %\\nArea :  7.176 m²\\nORDINARY PLY\\nHas Grain :  No\\nThickness :  6 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  6\\nSheets :  1\\nMaterial Cut Length :  13782 mm\\nMaterial Wastage :  42.63 %\\nArea :  1.708 m²\\nWHITE PARTICLE\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  63\\nSheets :  6\\nMaterial Cut Length :  120900.5 mm\\nMaterial Wastage :  20.42 %\\nArea :  14.214 m²\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2\\n\\nWHITE WATERPROOF\\nHas Grain :  No\\nThickness :  18 mm\\nSheet Length :  2440 mm\\nSheet Width :  1220 mm\\nMaterial Panels :  13\\nSheets :  1\\nMaterial Cut Length :  23265 mm\\nMaterial Wastage :  26.40 %\\nArea :  2.191 m²\\nEdging Materials\\nDark grey 1mm\\nThickness :  1 mm\\nLength :  99147 mm\\nRoll Length :  15000 mm\\nGenerated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2","logs":["Found section header \\"Edging Materials\\".","Detected edging entry \\"Dark grey 1mm\\".","Captured thickness \\"1 mm\\" for \\"Dark grey\\".","Captured used length \\"99147 mm\\" for \\"Dark grey\\".","Captured roll length \\"15000 mm\\" for \\"Dark grey\\".","Extracted 1 edging material item(s)."]}', '

Job Summary - URBAN VIBE INTERIOR137
Client Name : FARAOHOptimized Sheets : 12
Job Reference : -Total Panels : 114
Date Required : 4/23/2026Job Wastage : 27.17 %
Phone Number :Job Cut Length : 238436 mm
Fax Number :Unique Layouts : 12
Cell No : SHARONMaterials : 6
Sheet Materials
BLOCK BOARD
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  10
Sheets :  1
Material Cut Length :  31937.5 mm
Material Wastage :  75.51 %
Area :  0.729 m²
DARK GREY PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  22
Sheets :  3
Material Cut Length :  48551 mm
Material Wastage :  19.65 %
Area :  7.176 m²
ORDINARY PLY
Has Grain :  No
Thickness :  6 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  6
Sheets :  1
Material Cut Length :  13782 mm
Material Wastage :  42.63 %
Area :  1.708 m²
WHITE PARTICLE
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  63
Sheets :  6
Material Cut Length :  120900.5 mm
Material Wastage :  20.42 %
Area :  14.214 m²
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  1 of 2

WHITE WATERPROOF
Has Grain :  No
Thickness :  18 mm
Sheet Length :  2440 mm
Sheet Width :  1220 mm
Material Panels :  13
Sheets :  1
Material Cut Length :  23265 mm
Material Wastage :  26.40 %
Area :  2.191 m²
Edging Materials
Dark grey 1mm
Thickness :  1 mm
Length :  99147 mm
Roll Length :  15000 mm
Generated using MaxCut - visit www.maxcutsoftware.com to get your free copy4/23/2026Page  2 of 2', '2026-04-25 00:00:02', 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2');

DELETE FROM `odoo_model_fields_cache`;
INSERT INTO `odoo_model_fields_cache` (`model_name`, `fields_json`, `fetched_at`) VALUES ('sale.order', '[{"name":"expense_count","label":"# of Expenses","type":"integer"},{"name":"percentage_satisfaction","label":"% Happy","type":"integer"},{"name":"access_warning","label":"Access warning","type":"text"},{"name":"message_needaction","label":"Action Needed","type":"boolean"},{"name":"activity_ids","label":"Activities","type":"one2many"},{"name":"activity_exception_decoration","label":"Activity Exception Decoration","type":"selection"},{"name":"activity_state","label":"Activity State","type":"selection"},{"name":"activity_type_icon","label":"Activity Type Icon","type":"char"},{"name":"user_quantity","label":"Add Products","type":"boolean"},{"name":"x_studio_ai_job_summary_extract","label":"AI Job Summary Extract","type":"text"},{"name":"amount_invoiced","label":"Already invoiced","type":"monetary"},{"name":"amount_undiscounted","label":"Amount Before Discount","type":"float"},{"name":"assigned_grade_id","label":"Assigned Grade","type":"many2one"},{"name":"message_attachment_count","label":"Attachment Count","type":"integer"},{"name":"authorized_transaction_ids","label":"Authorized Transactions","type":"many2many"},{"name":"available_quotation_document_ids","label":"Available Quotation Documents","type":"many2many"},{"name":"rating_avg","label":"Average Rating","type":"float"},{"name":"campaign_id","label":"Campaign","type":"many2one"},{"name":"user_closable","label":"Closable","type":"boolean"},{"name":"close_reason_id","label":"Close Reason","type":"many2one"},{"name":"closed_task_count","label":"Closed Task Count","type":"integer"},{"name":"commercial_partner_id","label":"Commercial Entity","type":"many2one"},{"name":"company_id","label":"Company","type":"many2one"},{"name":"completed_task_percentage","label":"Completed Task Percentage","type":"float"},{"name":"payment_exception","label":"Contract in exception","type":"boolean"},{"name":"x_studio_copy_to_maxcut_as_reference","label":"Copy to MaxCut as Reference","type":"char"},{"name":"mrp_production_count","label":"Count of MO generated","type":"integer"},{"name":"country_code","label":"Country code","type":"char"},{"name":"create_uid","label":"Created by","type":"many2one"},{"name":"create_date","label":"Creation Date","type":"datetime"},{"name":"currency_id","label":"Currency","type":"many2one"},{"name":"currency_rate","label":"Currency Rate","type":"float"},{"name":"partner_id","label":"Customer","type":"many2one"},{"name":"client_order_ref","label":"Customer Reference","type":"char"},{"name":"customizable_pdf_form_fields","label":"Customizable PDF Form Fields","type":"json"},{"name":"company_price_include","label":"Default Sales Price Include","type":"selection"},{"name":"partner_shipping_id","label":"Delivery Address","type":"many2one"},{"name":"commitment_date","label":"Delivery Date","type":"datetime"},{"name":"delivery_count","label":"Delivery Orders","type":"integer"},{"name":"delivery_status","label":"Delivery Status","type":"selection"},{"name":"display_late","label":"Display Late","type":"boolean"},{"name":"display_name","label":"Display Name","type":"char"},{"name":"visible_project","label":"Display project","type":"boolean"},{"name":"display_recurring_stock_delivery_warning","label":"Display Recurring Stock Delivery Warning","type":"boolean"},{"name":"duplicated_order_ids","label":"Duplicated Order","type":"many2many"},{"name":"effective_date","label":"Effective Date","type":"datetime"},{"name":"end_date","label":"End Date","type":"date"},{"name":"expected_date","label":"Expected Date","type":"datetime"},{"name":"expense_ids","label":"Expenses","type":"one2many"},{"name":"validity_date","label":"Expiration","type":"date"},{"name":"origin_order_id","label":"First contract","type":"many2one"},{"name":"first_contract_date","label":"First Contract Date","type":"date"},{"name":"fiscal_position_id","label":"Fiscal Position","type":"many2one"},{"name":"message_follower_ids","label":"Followers","type":"one2many"},{"name":"message_partner_ids","label":"Followers (Partners)","type":"many2many"},{"name":"grid_product_tmpl_id","label":"Grid Product Tmpl","type":"many2one"},{"name":"grid_update","label":"Grid Update","type":"boolean"},{"name":"has_active_pricelist","label":"Has Active Pricelist","type":"boolean"},{"name":"has_archived_products","label":"Has Archived Products","type":"boolean"},{"name":"has_authorized_transaction_ids","label":"Has Authorized Transactions","type":"boolean"},{"name":"show_update_fpos","label":"Has Fiscal Position Changed","type":"boolean"},{"name":"show_json_popover","label":"Has late picking","type":"boolean"},{"name":"has_message","label":"Has Message","type":"boolean"},{"name":"show_update_pricelist","label":"Has Pricelist Changed","type":"boolean"},{"name":"has_recurring_line","label":"Has Recurring Line","type":"boolean"},{"name":"quotation_document_ids","label":"Headers/Footers","type":"many2many"},{"name":"history_count","label":"History Count","type":"integer"},{"name":"activity_exception_icon","label":"Icon","type":"char"},{"name":"id","label":"ID","type":"integer"},{"name":"incoterm","label":"Incoterm","type":"many2one"},{"name":"incoterm_location","label":"Incoterm Location","type":"char"},{"name":"internal_note","label":"Internal Note","type":"html"},{"name":"internal_note_display","label":"Internal Note Display","type":"html"},{"name":"partner_invoice_id","label":"Invoice Address","type":"many2one"},{"name":"invoice_count","label":"Invoice Count","type":"integer"},{"name":"invoice_status","label":"Invoice Status","type":"selection"},{"name":"invoice_ids","label":"Invoices","type":"many2many"},{"name":"journal_id","label":"Invoicing Journal","type":"many2one"},{"name":"is_invoice_cron","label":"Is a Subscription invoiced in cron","type":"boolean"},{"name":"is_batch","label":"Is Batch","type":"boolean"},{"name":"is_expired","label":"Is Expired","type":"boolean"},{"name":"message_is_follower","label":"Is Follower","type":"boolean"},{"name":"is_pdf_quote_builder_available","label":"Is Pdf Quote Builder Available","type":"boolean"},{"name":"is_product_milestone","label":"Is Product Milestone","type":"boolean"},{"name":"is_renewing","label":"Is Renewing","type":"boolean"},{"name":"is_upselling","label":"Is Upselling","type":"boolean"},{"name":"x_studio_job_summary_delta_json","label":"Job Summary Delta JSON","type":"text"},{"name":"x_studio_job_summary_edge_json","label":"Job Summary Edge JSON","type":"text"},{"name":"x_studio_job_summary_last_processed_on","label":"Job Summary Last Processed On","type":"datetime"},{"name":"x_studio_job_summary_processed","label":"Job Summary Processed","type":"boolean"},{"name":"x_studio_job_summary_processing_log","label":"Job Summary Processing Log","type":"text"},{"name":"x_studio_job_summary_signature","label":"Job Summary Signature","type":"char"},{"name":"x_studio_job_summary_stock_processed","label":"Job Summary Stock Processed","type":"boolean"},{"name":"x_studio_job_summary_stock_signature","label":"Job Summary Stock Signature","type":"char"},{"name":"json_popover","label":"JSON data for the popover widget","type":"char"},{"name":"kpi_1month_mrr_delta","label":"KPI 1 Month MRR Delta","type":"float"},{"name":"kpi_1month_mrr_percentage","label":"KPI 1 Month MRR Percentage","type":"float"},{"name":"kpi_3months_mrr_delta","label":"KPI 3 months MRR Delta","type":"float"},{"name":"kpi_3months_mrr_percentage","label":"KPI 3 Months MRR Percentage","type":"float"},{"name":"last_invoice_date","label":"Last invoice date","type":"date"},{"name":"x_studio_last_job_summary_attachment_id_1","label":"Last Job Summary Attachment ID ","type":"integer"},{"name":"x_studio_last_job_summary_filename","label":"Last Job Summary Filename","type":"char"},{"name":"last_reminder_date","label":"Last Reminder Date","type":"date"},{"name":"write_uid","label":"Last Updated by","type":"many2one"},{"name":"write_date","label":"Last Updated on","type":"datetime"},{"name":"late_availability","label":"Late Availability","type":"boolean"},{"name":"locked","label":"Locked","type":"boolean"},{"name":"mrp_production_ids","label":"Manufacturing orders associated with this sales order.","type":"many2many"},{"name":"grid","label":"Matrix local storage","type":"char"},{"name":"medium_id","label":"Medium","type":"many2one"},{"name":"starred_user_ids","label":"Members","type":"many2many"},{"name":"message_has_error","label":"Message Delivery error","type":"boolean"},{"name":"message_ids","label":"Messages","type":"one2many"},{"name":"milestone_count","label":"Milestone Count","type":"integer"},{"name":"recurring_monthly","label":"MRR","type":"monetary"},{"name":"my_activity_date_deadline","label":"My Activity Deadline","type":"date"},{"name":"x_studio_boolean_field_2n3_1jk4avs9r","label":"New CheckBox","type":"boolean"},{"name":"x_studio_selection_field_7rm_1jk4b57c7","label":"New Selection","type":"selection"},{"name":"activity_calendar_event_id","label":"Next Activity Calendar Event","type":"many2one"},{"name":"activity_date_deadline","label":"Next Activity Deadline","type":"date"},{"name":"activity_summary","label":"Next Activity Summary","type":"char"},{"name":"activity_type_id","label":"Next Activity Type","type":"many2one"},{"name":"next_invoice_date","label":"Next Invoice","type":"date"},{"name":"note_order","label":"Note Order","type":"many2one"},{"name":"message_needaction_counter","label":"Number of Actions","type":"integer"},{"name":"message_has_error_counter","label":"Number of errors","type":"integer"},{"name":"project_count","label":"Number of Projects","type":"integer"},{"name":"purchase_order_count","label":"Number of Purchase Order Generated","type":"integer"},{"name":"require_payment","label":"Online payment","type":"boolean"},{"name":"require_signature","label":"Online signature","type":"boolean"},{"name":"opportunity_id","label":"Opportunity","type":"many2one"},{"name":"date_order","label":"Order Date","type":"datetime"},{"name":"order_line","label":"Order Lines","type":"one2many"},{"name":"name","label":"Order Reference","type":"char"},{"name":"subscription_id","label":"Parent Contract","type":"many2one"},{"name":"partner_credit_warning","label":"Partner Credit Warning","type":"text"},{"name":"preferred_payment_method_line_id","label":"Payment Method","type":"many2one"},{"name":"reference","label":"Payment Ref.","type":"char"},{"name":"payment_term_id","label":"Payment Terms","type":"many2one"},{"name":"payment_token_id","label":"Payment Token","type":"many2one"},{"name":"amount_paid","label":"Payment Transactions Amount","type":"float"},{"name":"pending_email_template_id","label":"Pending Email Template","type":"many2one"},{"name":"pending_transaction","label":"Pending Transaction","type":"boolean"},{"name":"planning_first_sale_line_id","label":"Planning First Sale Line","type":"many2one"},{"name":"planning_hours_planned","label":"Planning Hours Planned","type":"float"},{"name":"planning_hours_to_plan","label":"Planning Hours To Plan","type":"float"},{"name":"planning_initial_date","label":"Planning Initial Date","type":"date"},{"name":"access_url","label":"Portal Access URL","type":"char"},{"name":"prepayment_percent","label":"Prepayment percentage","type":"float"},{"name":"x_studio_previous_job_summary_json","label":"Previous Job Summary JSON","type":"text"},{"name":"pricelist_id","label":"Pricelist","type":"many2one"},{"name":"report_grids","label":"Print Variant Grids","type":"boolean"},{"name":"project_id","label":"Project","type":"many2one"},{"name":"project_account_id","label":"Project Account","type":"many2one"},{"name":"project_ids","label":"Projects","type":"many2many"},{"name":"sale_order_template_id","label":"Quotation Template","type":"many2one"},{"name":"spreadsheet_template_id","label":"Quote calculator","type":"many2one"},{"name":"rating_avg_text","label":"Rating Avg Text","type":"selection"},{"name":"rating_count","label":"Rating count","type":"integer"},{"name":"rating_last_feedback","label":"Rating Last Feedback","type":"text"},{"name":"rating_last_image","label":"Rating Last Image","type":"binary"},{"name":"rating_last_value","label":"Rating Last Value","type":"float"},{"name":"rating_percentage_satisfaction","label":"Rating Satisfaction","type":"float"},{"name":"rating_last_text","label":"Rating Text","type":"selection"},{"name":"rating_ids","label":"Ratings","type":"one2many"},{"name":"is_subscription","label":"Recurring","type":"boolean"},{"name":"recurring_total","label":"Recurring Amount","type":"monetary"},{"name":"recurring_details","label":"Recurring Details","type":"html"},{"name":"plan_id","label":"Recurring Plan","type":"many2one"},{"name":"stock_reference_ids","label":"References","type":"many2many"},{"name":"user_extend","label":"Renew","type":"boolean"},{"name":"renewal_count","label":"Renewal Count","type":"integer"},{"name":"repair_order_ids","label":"Repair Order","type":"one2many"},{"name":"repair_count","label":"Repair Order(s)","type":"integer"},{"name":"activity_user_id","label":"Responsible User","type":"many2one"},{"name":"sale_warning_text","label":"Sale Warning","type":"text"},{"name":"team_id","label":"Sales Team","type":"many2one"},{"name":"user_id","label":"Salesperson","type":"many2one"},{"name":"access_token","label":"Security Token","type":"char"},{"name":"picking_policy","label":"Shipping Policy","type":"selection"},{"name":"show_create_project_button","label":"Show Create Project Button","type":"boolean"},{"name":"show_hours_recorded_button","label":"Show Hours Recorded Button","type":"boolean"},{"name":"show_project_button","label":"Show Project Button","type":"boolean"},{"name":"starred","label":"Show Subscription on dashboard","type":"boolean"},{"name":"signature","label":"Signature","type":"binary"},{"name":"signed_by","label":"Signed By","type":"char"},{"name":"signed_on","label":"Signed On","type":"datetime"},{"name":"message_has_sms_error","label":"SMS Delivery error","type":"boolean"},{"name":"source_id","label":"Source","type":"many2one"},{"name":"origin","label":"Source Document","type":"char"},{"name":"spreadsheet_id","label":"Spreadsheet","type":"many2one"},{"name":"spreadsheet_ids","label":"Spreadsheets","type":"one2many"},{"name":"start_date","label":"Start Date","type":"date"},{"name":"state","label":"Status","type":"selection"},{"name":"subscription_child_ids","label":"Subscription Child","type":"one2many"},{"name":"order_log_ids","label":"Subscription Logs","type":"one2many"},{"name":"subscription_state","label":"Subscription Status","type":"selection"},{"name":"tag_ids","label":"Tags","type":"many2many"},{"name":"tasks_count","label":"Tasks","type":"integer"},{"name":"tasks_ids","label":"Tasks associated with this sale","type":"many2many"},{"name":"tax_calculation_rounding_method","label":"Tax Calculation Rounding Method","type":"selection"},{"name":"tax_country_id","label":"Tax Country","type":"many2one"},{"name":"tax_totals","label":"Tax Totals","type":"binary"},{"name":"amount_tax","label":"Taxes","type":"monetary"},{"name":"team_user_id","label":"Team Leader","type":"many2one"},{"name":"terms_type","label":"Terms & Conditions format","type":"selection"},{"name":"note","label":"Terms and conditions","type":"html"},{"name":"timesheet_count","label":"Timesheet activities","type":"float"},{"name":"timesheet_encode_uom_id","label":"Timesheet Encoding Unit","type":"many2one"},{"name":"timesheet_total_duration","label":"Timesheet Total Duration","type":"integer"},{"name":"is_closing","label":"To Be Closed","type":"boolean"},{"name":"amount_total","label":"Total","type":"monetary"},{"name":"non_recurring_total","label":"Total Non Recurring Revenue","type":"monetary"},{"name":"transaction_ids","label":"Transactions","type":"many2many"},{"name":"x_studio_transferred","label":"Transferred","type":"char"},{"name":"x_studio_transferred_to_urban_vibe_2","label":"Transferred to URBAN VIBE 2","type":"boolean"},{"name":"picking_ids","label":"Transfers","type":"one2many"},{"name":"type_name","label":"Type Name","type":"char"},{"name":"amount_to_invoice","label":"Un-invoiced Balance","type":"monetary"},{"name":"amount_untaxed","label":"Untaxed Amount","type":"monetary"},{"name":"upsell_count","label":"Upsell Count","type":"integer"},{"name":"x_studio_urban_vibe_2_so_reference","label":"URBAN VIBE 2 SO Reference","type":"char"},{"name":"user_pause_start","label":"User Pause Start","type":"date"},{"name":"warehouse_id","label":"Warehouse","type":"many2one"},{"name":"warn_system_closing","label":"Warn System Closing","type":"boolean"},{"name":"website_message_ids","label":"Website Messages","type":"one2many"}]', '2026-04-25 10:45:30');

DELETE FROM `scheduler_runs`;
INSERT INTO `scheduler_runs` (`id`, `status`, `trigger_source`, `started_at`, `finished_at`, `scanned_count`, `processed_count`, `skipped_count`, `failed_count`, `summary`, `error_message`, `context_json`) VALUES ('0da43128-f734-438a-a565-8082042ae4e8', 'completed', 'manual', '2026-04-24 23:45:57', '2026-04-24 23:47:51', 15, 4, 11, 0, 'Scanned 15 Sales Order(s), reconciled 4, skipped 11, failed 0.', NULL, '{"confirmedFromDate":"2026-04-08 00:00:00","effectiveConfirmedFromDate":"2026-04-08 00:00:00","checkpointAt":"2026-04-24 10:47:04","lookbackHours":24,"batchSize":15,"trigger":"manual","orderOutcomes":[{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","status":"skipped","category":"already_reconciled","stage":"stock_reconciliation","reason":"This Job Summary signature already matches the stored stock reconciliation signature.","historyId":"98a3b523-1432-4be1-9dfa-e44d84699b28","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"77eb90b1-2acf-44fb-bc34-0ecf6ea24198","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"b70aceb8-03b5-4719-b9f2-78064e112f49","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2281,"orderName":"S02233","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2291,"orderName":"S02243","attachmentId":8235,"attachmentName":"Job Summaryd7ca6c39-aedb-4798-a510-dc09a456c838.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"dc26c861-11de-4186-9943-ed25c0efc705","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2295,"orderName":"S02247","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2294,"orderName":"S02246","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2293,"orderName":"S02245","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2292,"orderName":"S02244","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2287,"orderName":"S02239","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2285,"orderName":"S02237","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":1016,"orderName":"S01016","attachmentId":8199,"attachmentName":"Job Summary042bb1d1-45b4-411a-a95e-e45f829b60bc.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"ddc3558c-cbb5-4f50-801c-80f50f4f4a17","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":1,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2283,"orderName":"S02235","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2282,"orderName":"S02234","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."},{"orderId":2274,"orderName":"S02226","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."}]}');
INSERT INTO `scheduler_runs` (`id`, `status`, `trigger_source`, `started_at`, `finished_at`, `scanned_count`, `processed_count`, `skipped_count`, `failed_count`, `summary`, `error_message`, `context_json`) VALUES ('64290e2f-0ef1-4f0f-af23-523a7a5c25e4', 'completed', 'manual', '2026-04-24 23:55:46', '2026-04-24 23:56:26', 4, 2, 2, 0, 'Scanned 4 Sales Order(s), reconciled 2, skipped 2, failed 0.', NULL, '{"confirmedFromDate":"2026-04-08 00:00:00","effectiveConfirmedFromDate":"2026-04-23 07:47:04","checkpointAt":"2026-04-24 10:47:04","lookbackHours":24,"batchSize":15,"trigger":"manual","orderOutcomes":[{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","status":"skipped","category":"already_reconciled","stage":"stock_reconciliation","reason":"This Job Summary signature already matches the stored stock reconciliation signature.","historyId":"714642d5-4301-4ee6-8e1b-356512ecf582","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"42944f08-cd7d-42ce-b047-0dbac7967bd3","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"74474ad4-530f-4d79-a62c-fb40b279afab","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2281,"orderName":"S02233","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."}]}');
INSERT INTO `scheduler_runs` (`id`, `status`, `trigger_source`, `started_at`, `finished_at`, `scanned_count`, `processed_count`, `skipped_count`, `failed_count`, `summary`, `error_message`, `context_json`) VALUES ('e523094a-9b7d-4822-af77-09dc6f5ec328', 'completed', 'manual', '2026-04-24 23:56:56', '2026-04-24 23:57:49', 4, 2, 2, 0, 'Scanned 4 Sales Order(s), reconciled 2, skipped 2, failed 0.', NULL, '{"confirmedFromDate":"2026-04-08 00:00:00","effectiveConfirmedFromDate":"2026-04-23 07:47:04","checkpointAt":"2026-04-24 10:47:04","lookbackHours":24,"batchSize":15,"trigger":"manual","orderOutcomes":[{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","status":"skipped","category":"already_reconciled","stage":"stock_reconciliation","reason":"This Job Summary signature already matches the stored stock reconciliation signature.","historyId":"7548e2d9-4129-4028-881d-8deacd2df6b4","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"23312e8b-8a72-43c3-9c6f-003699abdd58","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"067dfd4d-f412-4962-973a-b5b9e69b190b","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2281,"orderName":"S02233","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."}]}');
INSERT INTO `scheduler_runs` (`id`, `status`, `trigger_source`, `started_at`, `finished_at`, `scanned_count`, `processed_count`, `skipped_count`, `failed_count`, `summary`, `error_message`, `context_json`) VALUES ('14882ac3-a6b3-46ca-9792-8f39e23a4d4b', 'completed', 'manual', '2026-04-24 23:59:05', '2026-04-25 00:00:09', 4, 2, 2, 0, 'Scanned 4 Sales Order(s), reconciled 2, skipped 2, failed 0.', NULL, '{"confirmedFromDate":"2026-04-08 00:00:00","effectiveConfirmedFromDate":"2026-04-23 07:47:04","checkpointAt":"2026-04-24 10:47:04","lookbackHours":24,"batchSize":15,"trigger":"manual","orderOutcomes":[{"orderId":2302,"orderName":"S02254","attachmentId":8256,"attachmentName":"Job Summary93169841-f941-4ba9-872b-4f2be80648f3 (1).pdf","status":"skipped","category":"already_reconciled","stage":"stock_reconciliation","reason":"This Job Summary signature already matches the stored stock reconciliation signature.","historyId":"7bbb6d48-a21a-46c3-bf86-eb339439f0d3","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":0,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2298,"orderName":"S02250","attachmentId":8254,"attachmentName":"Job Summaryfff00a32-50fd-4fa0-ba69-84defa564404.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"486dbc32-2472-4acd-b64b-501909f60ce3","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2296,"orderName":"S02248","attachmentId":8242,"attachmentName":"Job Summaryadc8e93a-75d7-43ef-8527-9831016344b8.pdf","status":"processed","category":"send_skipped_but_stock_processed","stage":"stock_reconciliation","reason":"Stock reconciliation completed successfully.","historyId":"ffeeaa85-9164-4688-a64d-fdca984a2751","extractionSkipped":true,"stockSummary":{"totalItems":1,"processedCount":0,"skippedCount":1,"failedCount":0,"missingSoItemsCount":0,"missingComponentCount":0,"zeroQuantityCount":0}},{"orderId":2281,"orderName":"S02233","status":"skipped","category":"missing_job_summary","stage":"attachment_lookup","reason":"No matching Job Summary PDF found."}]}');

DELETE FROM `scheduler_runtime_state`;
INSERT INTO `scheduler_runtime_state` (`id`, `lock_run_id`, `lock_acquired_at`, `last_successful_run_id`, `last_successful_finished_at`, `last_checkpoint_at`, `last_error_run_id`, `last_error_message`, `updated_at`) VALUES (1, NULL, NULL, '14882ac3-a6b3-46ca-9792-8f39e23a4d4b', '2026-04-25 00:00:09', '2026-04-24 10:47:04', NULL, NULL, '2026-04-25 00:00:09');

DELETE FROM `stock_processed_items`;
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('a962ff1b-2884-420c-807e-4d4055b9ec84', 2296, 'cee1443c07bb1eda389cde8d94c2992ea5796923b6c4836b8b6679fe5bd6bbb2', 113, 'Dark Grey', 15, 'b6a2c08a-9429-4aad-96af-8ddfd11d76fc', '2026-04-23 14:36:14');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('2ce8d5f1-3d63-4dee-b7b2-5e3718838b35', 2291, '8dc04543c606114600c4807c56fa24322077727a63107c44aa50841a80003520', 108, 'White', 15, 'c52ea6a3-4127-4eb7-825f-8a866562bd16', '2026-04-23 15:43:58');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('9cd6dc7b-00f3-480f-a0fa-d9f33536b466', 1016, 'c623f4e1462936af3a6a8dd691c7546ba72edc735dff19100edbfb761b0fd62c', 112, 'Light Grey', 15, '42e1473b-90a1-4e97-842c-ddc6eddd2b38', '2026-04-23 15:47:26');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('99549cb5-ff0b-497c-a545-27edc4bf12cd', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 786, 'Caraz', 150, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 15:50:31');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('67ddecee-3e98-40fd-b715-11f2e3038580', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 114, 'Esperanza', 150, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 15:50:35');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('8fbd8f02-3f2e-4998-a6c3-362172b27501', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 796, 'Neuro', 15, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 15:51:44');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('9fa896d3-0587-47ea-a63b-6e1254d59196', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 108, 'White', 15, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 15:51:48');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('8d5c125c-e931-4244-8d10-00e255d31fe4', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 229, 'Zalzach', 150, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 15:51:52');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('c20d3cb6-37b6-4d6e-abb5-faae720542a4', 2266, '67bf37f9035346c010786feeea9845ecebb30a54857b6378a9a06f1c686df3dc', 785, 'White Marble', 150, '8e055e9d-ba32-48ae-80b9-36693470612b', '2026-04-23 16:28:34');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('f6f52fa2-25d4-4a7d-9407-c714481703e9', 2263, 'fb633df7297e095db22e48f664e930ba12da6154f3e602db805024f79e81c74c', 230, 'Cappuccino', 150, '1c55bda9-9812-4bc1-afc8-1a7f32a80b26', '2026-04-23 16:32:50');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('59cbf039-89e8-48ba-b8b2-a67c56210533', 2261, '79ba76ce3a1505b6e093bfb35555fa25cb823aa563e3951547ca5c77cd6b419c', 108, 'White', 1, '2a478e95-81bf-4dd0-ab2a-11bd23cbe8fb', '2026-04-24 10:28:19');
INSERT INTO `stock_processed_items` (`id`, `order_id`, `extraction_signature`, `variant_id`, `normalized_color`, `quantity_added_meters`, `history_id`, `created_at`) VALUES ('1312ffb8-985e-47d5-9a41-1a8b27a23a8c', 2302, 'b90d2d25cefcf0612e8b4dba4d329f995383ec2622cdfbf1b17f6f15328d517f', 108, 'White', 1, 'eff11008-3801-4cf2-9724-1c2a87512d8d', '2026-04-24 22:15:23');

DELETE FROM `stock_processing_locks`;

DELETE FROM `stock_reversed_items`;
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('f6f52fa2-25d4-4a7d-9407-c714481703e9', 2263, '2026-04-23 17:08:16');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('c20d3cb6-37b6-4d6e-abb5-faae720542a4', 2266, '2026-04-23 17:12:12');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('8d5c125c-e931-4244-8d10-00e255d31fe4', 2266, '2026-04-23 17:12:14');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('9fa896d3-0587-47ea-a63b-6e1254d59196', 2266, '2026-04-23 17:12:15');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('8fbd8f02-3f2e-4998-a6c3-362172b27501', 2266, '2026-04-23 17:12:17');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('67ddecee-3e98-40fd-b715-11f2e3038580', 2266, '2026-04-23 17:12:19');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('99549cb5-ff0b-497c-a545-27edc4bf12cd', 2266, '2026-04-23 17:45:48');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('9cd6dc7b-00f3-480f-a0fa-d9f33536b466', 1016, '2026-04-23 17:55:43');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('2ce8d5f1-3d63-4dee-b7b2-5e3718838b35', 2291, '2026-04-23 19:37:05');
INSERT INTO `stock_reversed_items` (`processed_item_id`, `order_id`, `reversed_at`) VALUES ('a962ff1b-2884-420c-807e-4d4055b9ec84', 2296, '2026-04-23 19:38:37');

DELETE FROM `auth_login_challenges`;
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('4f312627-7288-46b6-8ffc-73665b7b16e6', 'dbadmin@urbanvibeinteriordesign.co.ke', 'a198cbe307211ba0547cef6b504c85368371cd9658fea8cd7b6b366466256e29', '/dashboard', '2026-04-24 19:38:18', 5, '2026-04-24 20:16:17', '::1', '2026-04-24 19:28:18');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('fb5a578f-2723-4de4-8dea-b54b8664e33c', 'dbadmin@urbanvibeinteriordesign.co.ke', '304641daaeef94b9d3e16a0da56ccc10a294c9b2a9825e3fe46cd76934ed34ea', '/dashboard', '2026-04-24 20:26:17', 5, '2026-04-24 20:17:31', '::1', '2026-04-24 20:16:17');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('fee2f7e8-7372-4896-b6a0-aa9bbdb4b2c7', 'dbadmin@urbanvibeinteriordesign.co.ke', '3a974655a65e26535b96496d391b0cc9c73d8acec607ac10537641935914ee66', '/dashboard', '2026-04-24 20:27:31', 5, '2026-04-24 20:18:01', '::1', '2026-04-24 20:17:31');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('9d02c1b4-5a24-4dec-95e2-b4d55641ad8c', 'dbadmin@urbanvibeinteriordesign.co.ke', '15125607e9001ba6285df4955e4889264f9e805c61c9fea1bda73b4ea1a80b6b', '/dashboard', '2026-04-24 20:28:01', 5, '2026-04-24 21:25:39', '::1', '2026-04-24 20:18:01');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('0d53f5b1-56d0-4c72-9f48-a1f8f21811e0', 'dbadmin@urbanvibeinteriordesign.co.ke', 'e10bfc235d22867b66223710407ce339abfc404727bab9cb1540e281fc20b935', '/dashboard', '2026-04-24 21:35:39', 5, '2026-04-24 21:27:17', '::1', '2026-04-24 21:25:39');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('ee9719b6-bc21-4d36-a366-20a7cfa05f75', 'dbadmin@urbanvibeinteriordesign.co.ke', '21da8a44ef5ad8cffbc54a7b178d7298f8c2e461e6097fa9e2b3dbc33720a910', '/dashboard', '2026-04-24 21:37:17', 5, '2026-04-24 21:29:24', '::1', '2026-04-24 21:27:17');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('79cc3104-4fbc-449b-82e6-4913277588f3', 'dbadmin@urbanvibeinteriordesign.co.ke', '6bf4d784f4b3f4df8d9bb321e8517c8df8c22894f7b7e7de6157a17cf1b73750', '/dashboard', '2026-04-24 21:39:24', 5, '2026-04-24 21:29:33', '::1', '2026-04-24 21:29:24');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('1ebf50f6-fe0c-4ebd-a63f-ed9b034c6a93', 'dbadmin@urbanvibeinteriordesign.co.ke', '60a70a2b075973278393dfdc80447a4c210ed4cf016d77f6c46d987f4f533a8c', '/dashboard', '2026-04-24 21:39:33', 5, '2026-04-24 21:42:01', '::1', '2026-04-24 21:29:33');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('ae952071-83c1-4633-adea-56765ba26ef7', 'leoivardomondi@flowcode.co.ke', '00c5b01be1436658b36f01ead8fdce9eab7ff9df725f6be36ba9e66bb5ed0a70', '/dashboard', '2026-04-24 21:50:27', 5, NULL, '::1', '2026-04-24 21:40:27');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('4a7dd45a-0664-42ef-9506-e8f9e4757d1d', 'dbadmin@urbanvibeinteriordesign.co.ke', 'b5571594128a8cabbbf31572d02ce57b223d5b820f7fbfe9002c9764305b9e5c', '/dashboard', '2026-04-24 21:52:01', 5, '2026-04-24 21:51:15', '::1', '2026-04-24 21:42:01');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('c7bec028-f547-400f-97ad-35f785c28525', 'dbadmin@urbanvibeinteriordesign.co.ke', '33110d7c811ad10d9b2b9fe07f490fb995c7acfe4ada36f8c6e8c6e79f8699f5', '/dashboard', '2026-04-24 22:01:15', 5, '2026-04-24 22:08:08', '::1', '2026-04-24 21:51:15');
INSERT INTO `auth_login_challenges` (`id`, `email`, `code_hash`, `redirect_path`, `expires_at`, `attempts_remaining`, `consumed_at`, `requested_ip`, `created_at`) VALUES ('0aab1a29-683e-4461-885e-59fab28c9f62', 'dbadmin@urbanvibeinteriordesign.co.ke', 'dafc6d8ef82cff49defdf6a17c06579fd265f9de83698491393be77fd63a4039', '/dashboard', '2026-04-24 22:18:08', 5, NULL, '::1', '2026-04-24 22:08:08');

DELETE FROM `auth_sessions`;
INSERT INTO `auth_sessions` (`id`, `email`, `role`, `csrf_token`, `user_agent_hash`, `ip_address`, `expires_at`, `revoked_at`, `created_at`, `last_seen_at`) VALUES ('75ff3f1f-1251-4527-abf7-e9f49c706e14', 'leoivardomondi@flowcode.co.ke', 'admin', 'a2d018b8d52e5bd54522e7a2407e8b1fc5ed413fa22f39f1', '13b80fc111e45ea6d82d6224c21628cd0ea675b7055ef61d34c510f1c62eb6d9', '::1', '2026-04-25 22:08:03', NULL, '2026-04-24 22:08:56', '2026-04-25 10:08:03');
INSERT INTO `auth_sessions` (`id`, `email`, `role`, `csrf_token`, `user_agent_hash`, `ip_address`, `expires_at`, `revoked_at`, `created_at`, `last_seen_at`) VALUES ('98d04b7a-0333-4a92-9435-07527d8cb233', 'leoivardomondi@flowcode.co.ke', 'admin', 'c0f35cf3fe269ea5e035e5c8ab597cb31f0a5384d37999bc', '13b80fc111e45ea6d82d6224c21628cd0ea675b7055ef61d34c510f1c62eb6d9', '::1', '2026-04-25 22:45:27', NULL, '2026-04-25 10:09:51', '2026-04-25 10:45:27');

DELETE FROM `auth_attempts`;
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('d6da81bf-a559-4de1-9fa2-14d526911d1b', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:25:41');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('3db1d7b7-df1a-447e-b5cf-9bdf6017d738', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:27:19');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('919f79ae-b870-4042-a28d-2dc705d3adbd', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:29:26');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('959e1fee-cb0e-45fe-bfa4-94b1c6245c53', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:29:34');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('37c0d15c-ee85-484e-bb0d-1ae50fe97051', 'otp_request', 'leoivardomondi@flowcode.co.ke', '::1', 1, '2026-04-24 21:42:05');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('473a198f-3b6c-444f-b83e-39f490e4c5f0', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:42:13');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('431c8948-b138-49a7-83ee-14a324bbdaba', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 21:51:20');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('51e8786c-0b33-4f78-a0f7-1c0ed4f7046d', 'otp_request', 'dbadmin@urbanvibeinteriordesign.co.ke', '::1', 1, '2026-04-24 22:08:11');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('15aa15a4-9892-4d57-bc71-2378d4138182', 'password_login', 'leoivardomondi@flowcode.co.ke', '::1', 1, '2026-04-24 22:08:56');
INSERT INTO `auth_attempts` (`id`, `scope`, `email`, `ip_address`, `success`, `created_at`) VALUES ('b1a432cd-551d-4e1b-aa3a-fe570cf56f43', 'password_login', 'leoivardomondi@flowcode.co.ke', '::1', 1, '2026-04-25 10:09:51');

DELETE FROM `auth_approved_users`;

SET FOREIGN_KEY_CHECKS = 1;
