-- Aşık Veysel 2027 Takvimi: ekip geneli paylaşılan tek belge (etkinlikler, damga vergisi oranı,
-- yetkili kullanıcılar ve ekip notu) burada saklanır. Her cihaz bu tek satırı okur/yazar.
CREATE TABLE team_state (
  doc_id TEXT PRIMARY KEY,
  events_json TEXT,
  stamp_rate DOUBLE PRECISION,
  users_json TEXT,
  note_text TEXT,
  updated_by TEXT,
  updated_at_ms BIGINT NOT NULL DEFAULT 0
);
