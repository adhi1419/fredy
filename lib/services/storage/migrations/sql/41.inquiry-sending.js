/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export function up(db) {
  db.exec(`
    ALTER TABLE jobs ADD COLUMN auto_send_inquiry INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE listings ADD COLUMN inquiry_send_status TEXT;
    ALTER TABLE listings ADD COLUMN inquiry_send_started_at INTEGER;
    ALTER TABLE listings ADD COLUMN inquiry_sent_at INTEGER;
    ALTER TABLE listings ADD COLUMN inquiry_request_id TEXT;
    ALTER TABLE listings ADD COLUMN inquiry_send_error TEXT;
  `);
}
