-- ================================================================
-- MIGRATION 141: TSI Carrier Coverage for NOCTE Store
-- ================================================================
-- Date: 2026-03-25
-- Purpose: Create TSI (Transportadora San Ignacio Loyola) carrier
--          and load full interior coverage at rate 0 (customer pays)
--
-- Store: NOCTE (gaston@thebrightidea.ai)
-- Store ID: 1eeaf2c7-2cd2-4257-8213-d90b1280a19d
-- Carrier: TSI (Transportadora San Ignacio Loyola)
--
-- SCOPE:
--   Excludes Gran Asuncion/Central (zone_code ASUNCION and CENTRAL)
--   All rates = 0 (customer pays shipping directly to TSI)
--   158 interior cities across 11 departments
--
-- SOURCES:
--   https://www.tsi.com.py/rutas-y-frecuencias (scraped 2026-03-25)
--
-- IDEMPOTENT: Safe to run multiple times
-- ================================================================

BEGIN;

-- ================================================================
-- 1. ADD MISSING LOCATIONS TO PARAGUAY_LOCATIONS
-- ================================================================
-- Cities served by TSI that are not in the master locations table.
-- These are real localities (cruces, colonias, small towns) that
-- TSI delivers to and customers may search for.

INSERT INTO paraguay_locations (city, department, zone_code, city_normalized, department_normalized) VALUES
    -- Alto Parana
    ('Cruce Aurora', 'ALTO PARANA', 'INTERIOR_2', 'cruce aurora', 'alto parana'),
    ('Cruce Guaraní', 'ALTO PARANA', 'INTERIOR_2', 'cruce guarani', 'alto parana'),
    ('Cruce Itakyry', 'ALTO PARANA', 'INTERIOR_2', 'cruce itakyry', 'alto parana'),
    ('Limoy', 'ALTO PARANA', 'INTERIOR_2', 'limoy', 'alto parana'),
    -- Caaguazu
    ('Colonia Blas Garay', 'CAAGUAZU', 'INTERIOR_2', 'colonia blas garay', 'caaguazu'),
    ('Colonia Carlos Pfannl', 'CAAGUAZU', 'INTERIOR_2', 'colonia carlos pfannl', 'caaguazu'),
    ('Cruce Mbutuy', 'CAAGUAZU', 'INTERIOR_2', 'cruce mbutuy', 'caaguazu'),
    ('Cruce Santo Domingo', 'CAAGUAZU', 'INTERIOR_2', 'cruce santo domingo', 'caaguazu'),
    ('Pastoreo', 'CAAGUAZU', 'INTERIOR_2', 'pastoreo', 'caaguazu'),
    -- Canindeyu
    ('Cruce Mbaracayu', 'CANINDEYU', 'INTERIOR_2', 'cruce mbaracayu', 'canindeyu'),
    ('Kumanda Kai', 'CANINDEYU', 'INTERIOR_2', 'kumanda kai', 'canindeyu'),
    -- Guaira
    ('Colonia Independencia', 'GUAIRA', 'INTERIOR_2', 'colonia independencia', 'guaira'),
    -- Itapua
    ('Colonia Berthal', 'ITAPUA', 'INTERIOR_2', 'colonia berthal', 'itapua'),
    ('Colonia La Fortuna', 'ITAPUA', 'INTERIOR_2', 'colonia la fortuna', 'itapua'),
    ('Colonia Sommerfeld', 'ITAPUA', 'INTERIOR_2', 'colonia sommerfeld', 'itapua'),
    ('Colonias Unidas', 'ITAPUA', 'INTERIOR_2', 'colonias unidas', 'itapua'),
    ('Cruce Carolina', 'ITAPUA', 'INTERIOR_2', 'cruce carolina', 'itapua'),
    ('Cruce Ferreira', 'ITAPUA', 'INTERIOR_2', 'cruce ferreira', 'itapua'),
    ('Jorge Naville', 'ITAPUA', 'INTERIOR_2', 'jorge naville', 'itapua'),
    ('Karonay', 'ITAPUA', 'INTERIOR_2', 'karonay', 'itapua'),
    ('Kressburgo', 'ITAPUA', 'INTERIOR_2', 'kressburgo', 'itapua'),
    ('Naranjito', 'ITAPUA', 'INTERIOR_2', 'naranjito', 'itapua'),
    ('Pirapey', 'ITAPUA', 'INTERIOR_2', 'pirapey', 'itapua'),
    ('San Roque González', 'ITAPUA', 'INTERIOR_2', 'san roque gonzalez', 'itapua'),
    ('Torin', 'ITAPUA', 'INTERIOR_2', 'torin', 'itapua'),
    ('Yacuty', 'ITAPUA', 'INTERIOR_2', 'yacuty', 'itapua'),
    -- Paraguari
    ('Curupayty', 'PARAGUARI', 'INTERIOR_2', 'curupayty', 'paraguari'),
    -- San Pedro
    ('Barrio San Pedro', 'SAN PEDRO', 'INTERIOR_2', 'barrio san pedro', 'san pedro')
ON CONFLICT (city, department) DO NOTHING;

-- ================================================================
-- 2. CREATE TSI CARRIER FOR NOCTE STORE
-- ================================================================

DO $$
DECLARE
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_coverage JSONB;
    v_count INT;
BEGIN
    -- Check store exists
    IF NOT EXISTS (SELECT 1 FROM stores WHERE id = v_store_id) THEN
        RAISE EXCEPTION 'Store NOCTE (%) not found', v_store_id;
    END IF;

    -- Find or create TSI carrier
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND (
          LOWER(TRIM(name)) LIKE '%tsi%'
          OR LOWER(TRIM(name)) LIKE '%transportadora san ignacio%'
      )
      AND is_active = TRUE
    LIMIT 1;

    IF v_carrier_id IS NULL THEN
        INSERT INTO carriers (id, store_id, name, phone, is_active)
        VALUES (
            gen_random_uuid(),
            v_store_id,
            'TSI (Transportadora San Ignacio)',
            '(021) 557 030',
            TRUE
        )
        RETURNING id INTO v_carrier_id;

        RAISE NOTICE 'Created carrier TSI with ID: %', v_carrier_id;
    ELSE
        RAISE NOTICE 'Found existing TSI carrier with ID: %', v_carrier_id;
    END IF;

    -- ============================================================
    -- 3. BULK INSERT CARRIER COVERAGE (ALL INTERIOR CITIES)
    -- ============================================================
    -- Rate = 0 for all cities (customer pays shipping to TSI)
    -- Excludes: Asuncion, Central department

    v_coverage := '[
        {"city": "Altos", "department": "CORDILLERA", "rate": 0},
        {"city": "Arroyos y Esteros", "department": "CORDILLERA", "rate": 0},
        {"city": "Atyrá", "department": "CORDILLERA", "rate": 0},
        {"city": "Caacupé", "department": "CORDILLERA", "rate": 0},
        {"city": "Caraguatay", "department": "CORDILLERA", "rate": 0},
        {"city": "Emboscada", "department": "CORDILLERA", "rate": 0},
        {"city": "Eusebio Ayala", "department": "CORDILLERA", "rate": 0},
        {"city": "Isla Pucú", "department": "CORDILLERA", "rate": 0},
        {"city": "Itacurubí de la Cordillera", "department": "CORDILLERA", "rate": 0},
        {"city": "Piribebuy", "department": "CORDILLERA", "rate": 0},
        {"city": "Primero de Marzo", "department": "CORDILLERA", "rate": 0},
        {"city": "San Bernardino", "department": "CORDILLERA", "rate": 0},
        {"city": "Tobatí", "department": "CORDILLERA", "rate": 0},

        {"city": "Acahay", "department": "PARAGUARI", "rate": 0},
        {"city": "Caapucú", "department": "PARAGUARI", "rate": 0},
        {"city": "Carapeguá", "department": "PARAGUARI", "rate": 0},
        {"city": "Curupayty", "department": "PARAGUARI", "rate": 0},
        {"city": "Escobar", "department": "PARAGUARI", "rate": 0},
        {"city": "Gral. Bernardino Caballero", "department": "PARAGUARI", "rate": 0},
        {"city": "La Colmena", "department": "PARAGUARI", "rate": 0},
        {"city": "Paraguarí", "department": "PARAGUARI", "rate": 0},
        {"city": "Pirayú", "department": "PARAGUARI", "rate": 0},
        {"city": "Quiindy", "department": "PARAGUARI", "rate": 0},
        {"city": "Sapucai", "department": "PARAGUARI", "rate": 0},
        {"city": "Yaguarón", "department": "PARAGUARI", "rate": 0},
        {"city": "Ybycuí", "department": "PARAGUARI", "rate": 0},

        {"city": "Borja", "department": "GUAIRA", "rate": 0},
        {"city": "Colonia Independencia", "department": "GUAIRA", "rate": 0},
        {"city": "Coronel Martinez", "department": "GUAIRA", "rate": 0},
        {"city": "Félix Pérez Cardozo", "department": "GUAIRA", "rate": 0},
        {"city": "Independencia", "department": "GUAIRA", "rate": 0},
        {"city": "Iturbe", "department": "GUAIRA", "rate": 0},
        {"city": "Jose Mauricio Troche", "department": "GUAIRA", "rate": 0},
        {"city": "Natalicio Talavera", "department": "GUAIRA", "rate": 0},
        {"city": "Ñumi", "department": "GUAIRA", "rate": 0},
        {"city": "Paso Yobai", "department": "GUAIRA", "rate": 0},
        {"city": "San Salvador", "department": "GUAIRA", "rate": 0},
        {"city": "Tebicuary", "department": "GUAIRA", "rate": 0},
        {"city": "Villarrica", "department": "GUAIRA", "rate": 0},
        {"city": "Yataity", "department": "GUAIRA", "rate": 0},

        {"city": "Abai", "department": "CAAZAPA", "rate": 0},
        {"city": "Buena Vista", "department": "CAAZAPA", "rate": 0},
        {"city": "Caazapá", "department": "CAAZAPA", "rate": 0},
        {"city": "Fulgencio Yegros", "department": "CAAZAPA", "rate": 0},
        {"city": "General Higinio Morínigo", "department": "CAAZAPA", "rate": 0},
        {"city": "San Juan Nepomuceno", "department": "CAAZAPA", "rate": 0},
        {"city": "Tavaí", "department": "CAAZAPA", "rate": 0},
        {"city": "Yuty", "department": "CAAZAPA", "rate": 0},

        {"city": "Ayolas", "department": "MISIONES", "rate": 0},
        {"city": "Maria Auxiliadora", "department": "MISIONES", "rate": 0},
        {"city": "San Ignacio Guazú", "department": "MISIONES", "rate": 0},
        {"city": "San Juan Bautista", "department": "MISIONES", "rate": 0},
        {"city": "San Miguel", "department": "MISIONES", "rate": 0},
        {"city": "San Patricio", "department": "MISIONES", "rate": 0},
        {"city": "Santa Rosa Misiones", "department": "MISIONES", "rate": 0},
        {"city": "Santiago", "department": "MISIONES", "rate": 0},
        {"city": "Villa Florida", "department": "MISIONES", "rate": 0},

        {"city": "Alberdi", "department": "ÑEEMBUCU", "rate": 0},
        {"city": "Pilar", "department": "ÑEEMBUCU", "rate": 0},

        {"city": "Alto Vera", "department": "ITAPUA", "rate": 0},
        {"city": "Bella Vista", "department": "ITAPUA", "rate": 0},
        {"city": "Cambyreta", "department": "ITAPUA", "rate": 0},
        {"city": "Capitan Meza", "department": "ITAPUA", "rate": 0},
        {"city": "Capitan Miranda", "department": "ITAPUA", "rate": 0},
        {"city": "Carlos Antonio López", "department": "ITAPUA", "rate": 0},
        {"city": "Carmen del Parana", "department": "ITAPUA", "rate": 0},
        {"city": "Colonia Berthal", "department": "ITAPUA", "rate": 0},
        {"city": "Colonia La Fortuna", "department": "ITAPUA", "rate": 0},
        {"city": "Colonia Sommerfeld", "department": "ITAPUA", "rate": 0},
        {"city": "Colonias Unidas", "department": "ITAPUA", "rate": 0},
        {"city": "Coronel Bogado", "department": "ITAPUA", "rate": 0},
        {"city": "Cruce Carolina", "department": "ITAPUA", "rate": 0},
        {"city": "Cruce Ferreira", "department": "ITAPUA", "rate": 0},
        {"city": "Edelira", "department": "ITAPUA", "rate": 0},
        {"city": "Encarnación", "department": "ITAPUA", "rate": 0},
        {"city": "Fram", "department": "ITAPUA", "rate": 0},
        {"city": "General Jose Maria Delgado", "department": "ITAPUA", "rate": 0},
        {"city": "Gral. Artigas", "department": "ITAPUA", "rate": 0},
        {"city": "Hohenau", "department": "ITAPUA", "rate": 0},
        {"city": "Itapua Poty", "department": "ITAPUA", "rate": 0},
        {"city": "Jesús de Tavarangué", "department": "ITAPUA", "rate": 0},
        {"city": "Jorge Naville", "department": "ITAPUA", "rate": 0},
        {"city": "Karonay", "department": "ITAPUA", "rate": 0},
        {"city": "Kressburgo", "department": "ITAPUA", "rate": 0},
        {"city": "La Paz", "department": "ITAPUA", "rate": 0},
        {"city": "Mayor Otaño", "department": "ITAPUA", "rate": 0},
        {"city": "Naranjito", "department": "ITAPUA", "rate": 0},
        {"city": "Natalio", "department": "ITAPUA", "rate": 0},
        {"city": "Obligado", "department": "ITAPUA", "rate": 0},
        {"city": "Pirapo", "department": "ITAPUA", "rate": 0},
        {"city": "Pirapey", "department": "ITAPUA", "rate": 0},
        {"city": "San Cosme y Damián", "department": "ITAPUA", "rate": 0},
        {"city": "San Juan del Paraná", "department": "ITAPUA", "rate": 0},
        {"city": "San Pedro del Paraná", "department": "ITAPUA", "rate": 0},
        {"city": "San Rafael del Parana", "department": "ITAPUA", "rate": 0},
        {"city": "San Roque González", "department": "ITAPUA", "rate": 0},
        {"city": "Torin", "department": "ITAPUA", "rate": 0},
        {"city": "Trinidad", "department": "ITAPUA", "rate": 0},
        {"city": "Yacuty", "department": "ITAPUA", "rate": 0},
        {"city": "Yatytay", "department": "ITAPUA", "rate": 0},

        {"city": "Ciudad del Este", "department": "ALTO PARANA", "rate": 0},
        {"city": "Cruce Aurora", "department": "ALTO PARANA", "rate": 0},
        {"city": "Cruce Guaraní", "department": "ALTO PARANA", "rate": 0},
        {"city": "Cruce Itakyry", "department": "ALTO PARANA", "rate": 0},
        {"city": "Doctor Juan León Mallorquín", "department": "ALTO PARANA", "rate": 0},
        {"city": "Doctor Raúl Peña", "department": "ALTO PARANA", "rate": 0},
        {"city": "Domingo Martínez de Irala", "department": "ALTO PARANA", "rate": 0},
        {"city": "Hernandarias", "department": "ALTO PARANA", "rate": 0},
        {"city": "Iruña", "department": "ALTO PARANA", "rate": 0},
        {"city": "Itakyry", "department": "ALTO PARANA", "rate": 0},
        {"city": "Juan Emilio O''Leary", "department": "ALTO PARANA", "rate": 0},
        {"city": "Limoy", "department": "ALTO PARANA", "rate": 0},
        {"city": "Los Cedrales", "department": "ALTO PARANA", "rate": 0},
        {"city": "Minga Guazú", "department": "ALTO PARANA", "rate": 0},
        {"city": "Minga Porá", "department": "ALTO PARANA", "rate": 0},
        {"city": "Naranjal", "department": "ALTO PARANA", "rate": 0},
        {"city": "Presidente Franco", "department": "ALTO PARANA", "rate": 0},
        {"city": "San Alberto", "department": "ALTO PARANA", "rate": 0},
        {"city": "San Cristóbal", "department": "ALTO PARANA", "rate": 0},
        {"city": "Santa Fe del Paraná", "department": "ALTO PARANA", "rate": 0},
        {"city": "Santa Rita", "department": "ALTO PARANA", "rate": 0},
        {"city": "Santa Rosa del Monday", "department": "ALTO PARANA", "rate": 0},
        {"city": "Tavapy", "department": "ALTO PARANA", "rate": 0},
        {"city": "Yguazú", "department": "ALTO PARANA", "rate": 0},

        {"city": "Caaguazú", "department": "CAAGUAZU", "rate": 0},
        {"city": "Colonia Blas Garay", "department": "CAAGUAZU", "rate": 0},
        {"city": "Colonia Carlos Pfannl", "department": "CAAGUAZU", "rate": 0},
        {"city": "Coronel Oviedo", "department": "CAAGUAZU", "rate": 0},
        {"city": "Cruce Mbutuy", "department": "CAAGUAZU", "rate": 0},
        {"city": "Cruce Santo Domingo", "department": "CAAGUAZU", "rate": 0},
        {"city": "Dr. J. Eulogio Estigarribia", "department": "CAAGUAZU", "rate": 0},
        {"city": "Dr. Juan Manuel Frutos", "department": "CAAGUAZU", "rate": 0},
        {"city": "Jose Domingo Ocampos", "department": "CAAGUAZU", "rate": 0},
        {"city": "Nueva Toledo", "department": "CAAGUAZU", "rate": 0},
        {"city": "Pastoreo", "department": "CAAGUAZU", "rate": 0},
        {"city": "Raul Arsenio Oviedo", "department": "CAAGUAZU", "rate": 0},
        {"city": "San Jose de los Arroyos", "department": "CAAGUAZU", "rate": 0},
        {"city": "Vaqueria", "department": "CAAGUAZU", "rate": 0},
        {"city": "Yhu", "department": "CAAGUAZU", "rate": 0},

        {"city": "Capiibary", "department": "SAN PEDRO", "rate": 0},
        {"city": "Cruce Mbaracayu", "department": "CANINDEYU", "rate": 0},
        {"city": "Curuguaty", "department": "CANINDEYU", "rate": 0},
        {"city": "Gral. Francisco Caballero Álvarez", "department": "CANINDEYU", "rate": 0},
        {"city": "Katueté", "department": "CANINDEYU", "rate": 0},
        {"city": "Kumanda Kai", "department": "CANINDEYU", "rate": 0},
        {"city": "La Paloma", "department": "CANINDEYU", "rate": 0},
        {"city": "Nueva Esperanza", "department": "CANINDEYU", "rate": 0},
        {"city": "Puente Kyha", "department": "CANINDEYU", "rate": 0},
        {"city": "Salto del Guaira", "department": "CANINDEYU", "rate": 0},
        {"city": "Yasy Cañy", "department": "CANINDEYU", "rate": 0},

        {"city": "25 de diciembre", "department": "SAN PEDRO", "rate": 0},
        {"city": "Barrio San Pedro", "department": "SAN PEDRO", "rate": 0},
        {"city": "Choré", "department": "SAN PEDRO", "rate": 0},
        {"city": "Gral. Resquín", "department": "SAN PEDRO", "rate": 0},
        {"city": "Guayaibí", "department": "SAN PEDRO", "rate": 0},
        {"city": "Liberación", "department": "SAN PEDRO", "rate": 0},
        {"city": "San Estanislao", "department": "SAN PEDRO", "rate": 0},
        {"city": "Santa Rosa del Aguaray", "department": "SAN PEDRO", "rate": 0}
    ]'::JSONB;

    -- Use the existing import function (handles upsert)
    SELECT import_carrier_coverage(v_store_id, v_carrier_id, v_coverage) INTO v_count;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'MIGRATION 141 COMPLETED SUCCESSFULLY';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Carrier: TSI (Transportadora San Ignacio Loyola)';
    RAISE NOTICE 'Store: NOCTE';
    RAISE NOTICE 'Coverage entries loaded: %', v_count;
    RAISE NOTICE 'Rate: 0 (customer pays shipping to TSI)';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'DEPARTMENTS COVERED:';
    RAISE NOTICE '  CORDILLERA:  13 cities';
    RAISE NOTICE '  PARAGUARI:   13 cities';
    RAISE NOTICE '  GUAIRA:      14 cities';
    RAISE NOTICE '  CAAZAPA:      8 cities';
    RAISE NOTICE '  MISIONES:     9 cities';
    RAISE NOTICE '  ÑEEMBUCU:     2 cities';
    RAISE NOTICE '  ITAPUA:      41 cities';
    RAISE NOTICE '  ALTO PARANA: 24 cities';
    RAISE NOTICE '  CAAGUAZU:    15 cities';
    RAISE NOTICE '  CANINDEYU:   10 cities';
    RAISE NOTICE '  SAN PEDRO:    9 cities';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'EXCLUDED: Asuncion, Central (Gran Asuncion)';
    RAISE NOTICE '================================================';
END $$;

-- ================================================================
-- 4. VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_total INT;
    v_departments TEXT;
BEGIN
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND (
          LOWER(TRIM(name)) LIKE '%tsi%'
          OR LOWER(TRIM(name)) LIKE '%transportadora san ignacio%'
      )
      AND is_active = TRUE
    LIMIT 1;

    SELECT COUNT(*) INTO v_total
    FROM carrier_coverage
    WHERE carrier_id = v_carrier_id
      AND is_active = TRUE;

    SELECT string_agg(DISTINCT cc.department, ', ' ORDER BY cc.department) INTO v_departments
    FROM carrier_coverage cc
    WHERE cc.carrier_id = v_carrier_id
      AND cc.is_active = TRUE;

    RAISE NOTICE 'VERIFICATION: TSI has % active coverage entries', v_total;
    RAISE NOTICE 'DEPARTMENTS: %', v_departments;

    IF v_total < 155 THEN
        RAISE WARNING 'Expected 158 coverage entries, got %. Check for issues.', v_total;
    END IF;
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 141 COMPLETED
-- ================================================================
-- Created: TSI carrier for NOCTE store
-- Loaded: 158 interior city coverage entries at rate 0
-- Added: 28 new locations to paraguay_locations master table
--
-- New locations added:
--   Cruce Aurora, Cruce Guaraní, Cruce Itakyry, Limoy,
--   Colonia Blas Garay, Colonia Carlos Pfannl, Cruce Mbutuy,
--   Cruce Santo Domingo, Pastoreo, Cruce Mbaracayu, Kumanda Kai,
--   Colonia Independencia, Colonia Berthal, Colonia La Fortuna,
--   Colonia Sommerfeld, Colonias Unidas, Cruce Carolina,
--   Cruce Ferreira, Jorge Naville, Karonay, Kressburgo,
--   Naranjito, Pirapey, San Roque González, Torin, Yacuty,
--   Curupayty, Barrio San Pedro
--
-- TSI contact: (021) 557 030 | WhatsApp +595 976 933 610
-- Frequencies: major cities daily (Mon-Sat), rural 2-3x/week
-- ================================================================
