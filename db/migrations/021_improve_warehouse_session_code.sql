-- Migration 021: Improve Warehouse Session Code Format
-- Changes session code from PREP-YYMM-NN to PREP-YYYYMMDD-NN for better date clarity

-- ============================================================================
-- Update generate_session_code function to use full date format
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS VARCHAR(50) AS $$
DECLARE
    new_code VARCHAR(50);
    code_exists BOOLEAN;
    attempt INTEGER := 0;
    max_attempts INTEGER := 100;
    date_part VARCHAR(10);
    sequence_num INTEGER;
BEGIN
    -- Get current date in DDMMYYYY format (Latin American format)
    date_part := TO_CHAR(NOW(), 'DDMMYYYY');

    LOOP
        -- Get the next sequence number for this day
        SELECT COALESCE(MAX(
            CAST(
                SUBSTRING(code FROM 'PREP-[0-9]{8}-([0-9]+)') AS INTEGER
            )
        ), 0) + 1
        INTO sequence_num
        FROM picking_sessions
        WHERE code LIKE 'PREP-' || date_part || '-%';

        -- Generate code: PREP-DDMMYYYY-NN (e.g., PREP-02122025-01 for Dec 2, 2025)
        new_code := 'PREP-' || date_part || '-' || LPAD(sequence_num::TEXT, 2, '0');

        -- Check if code exists
        SELECT EXISTS(SELECT 1 FROM picking_sessions WHERE code = new_code) INTO code_exists;

        EXIT WHEN NOT code_exists OR attempt >= max_attempts;

        attempt := attempt + 1;
    END LOOP;

    IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Failed to generate unique session code after % attempts', max_attempts;
    END IF;

    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the new format
COMMENT ON FUNCTION generate_session_code IS 'Generates unique picking session codes in format PREP-DDMMYYYY-NN (e.g., PREP-02122025-01 for December 2, 2025)';
