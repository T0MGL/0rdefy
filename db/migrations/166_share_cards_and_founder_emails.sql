-- ============================================================================
-- Migration 166 — Share cards and founder milestone emails
-- ============================================================================
-- Powers the milestone retention/virality channel:
--   - share_cards         : public share pages (token-addressed, public_data
--                            and private_data variants for owner privacy toggle)
--   - founder_emails_sent : idempotency log so each (store, milestone) is
--                            emailed exactly once
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- share_cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    milestone_type TEXT NOT NULL,
    milestone_value INT NOT NULL,
    public_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    private_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    view_count INT NOT NULL DEFAULT 0,
    share_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_cards_token ON share_cards(token);
CREATE INDEX IF NOT EXISTS idx_share_cards_store ON share_cards(store_id);
CREATE INDEX IF NOT EXISTS idx_share_cards_created ON share_cards(created_at DESC);

COMMENT ON TABLE share_cards IS
    'Tokenized public share pages for milestone moments (Spotify Wrapped style).';
COMMENT ON COLUMN share_cards.public_data IS
    'JSON shown publicly (abstract: milestone value, store handle, no raw revenue).';
COMMENT ON COLUMN share_cards.private_data IS
    'JSON shown only when owner toggles private view (raw figures, margin, etc).';

-- ---------------------------------------------------------------------------
-- founder_emails_sent (idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS founder_emails_sent (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    email_type TEXT NOT NULL,
    milestone_value INT,
    share_card_id UUID REFERENCES share_cards(id) ON DELETE SET NULL,
    message_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_id, email_type, milestone_value)
);

CREATE INDEX IF NOT EXISTS idx_founder_emails_store ON founder_emails_sent(store_id);
CREATE INDEX IF NOT EXISTS idx_founder_emails_sent_at ON founder_emails_sent(sent_at DESC);

COMMENT ON TABLE founder_emails_sent IS
    'Idempotency log for founder-signed milestone emails. UNIQUE (store, type, value) prevents double sends.';
