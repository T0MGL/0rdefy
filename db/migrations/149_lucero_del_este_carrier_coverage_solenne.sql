-- ================================================================
-- MIGRATION 149: Lucero del Este Carrier Coverage for SOLENNE Store
-- ================================================================
-- Date: 2026-04-11
-- Author: ordefy-ceo
-- Purpose: Enable shipping rate calculation for Solenne DTC skincare
--          checkouts using Lucero del Este as carrier.
--
-- Store: Solenne (bysolenne.shop)
-- Store ID: 0b3f13f8-d1dc-48a5-a707-27a095c9c545
-- Carrier: Lucero del Este
--
-- SOURCE OF RATES:
--   Cloned from NOCTE store (store_id 1eeaf2c7-...) which uses the
--   same carrier (Lucero del Este) in production. Same carrier, same
--   country (PY), same courier operator, same PYG currency. Rates
--   verified directly from carrier_coverage for NOCTE on 2026-04-11.
--
-- COVERAGE SUMMARY:
--   Total entries: 266 cities across 18 departments
--   With rate (has coverage): 59 cities
--   Null rate (no coverage in the carriers network): 207 cities
--
-- KEY ROUTES WITH RATE (PYG):
--   ASUNCION: Asunción 25000
--   CENTRAL:  Luque 30000, San Lorenzo 25000, Lambaré 25000,
--             Fernando de la Mora 30000, Capiatá 35000, Ñemby 35000,
--             Villa Elisa 30000, Mariano Roque Alonso 30000,
--             Villeta 30000, Limpio 35000, and 13 more Gran Asuncion cities.
--   ALTO PARANA: Ciudad del Este 20000, Hernandarias 25000,
--                Presidente Franco 25000, Minga Guazú 30000, and 11 more.
--   CONCEPCION: Concepción 45000, Horqueta 45000
--   AMAMBAY:    Pedro Juan Caballero 45000
--   GUAIRA:     Villarrica 40000
--   ITAPUA:     Encarnación 35000
--
-- IDEMPOTENT: Uses import_carrier_coverage() which upserts by
--             (carrier_id, LOWER(city), LOWER(department)). Safe to re-run.
-- ================================================================

BEGIN;

DO $$
DECLARE
    v_store_id UUID := '0b3f13f8-d1dc-48a5-a707-27a095c9c545';
    v_carrier_id UUID;
    v_coverage JSONB;
    v_count INT;
    v_with_rate INT;
BEGIN
    -- Guard: store must exist
    IF NOT EXISTS (SELECT 1 FROM stores WHERE id = v_store_id) THEN
        RAISE EXCEPTION 'Store SOLENNE (%) not found', v_store_id;
    END IF;

    -- Find or create Lucero del Este carrier for Solenne
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) LIKE '%lucero del este%'
      AND is_active = TRUE
    LIMIT 1;

    IF v_carrier_id IS NULL THEN
        INSERT INTO carriers (id, store_id, name, phone, is_active)
        VALUES (
            gen_random_uuid(),
            v_store_id,
            'Lucero del Este',
            NULL,
            TRUE
        )
        RETURNING id INTO v_carrier_id;
        RAISE NOTICE 'Created carrier "Lucero del Este" for SOLENNE: %', v_carrier_id;
    ELSE
        RAISE NOTICE 'Found existing Lucero del Este carrier: %', v_carrier_id;
    END IF;

    -- Coverage payload (266 entries, sorted by department then city)
    -- Rates cloned from NOCTE production values as of 2026-04-11.
    v_coverage := $json$[
        {"city": "Bahía Negra", "department": "ALTO PARAGUAY", "rate": null},
        {"city": "Capitán Carmelo Peralta", "department": "ALTO PARAGUAY", "rate": null},
        {"city": "Fuerte Olimpo", "department": "ALTO PARAGUAY", "rate": null},
        {"city": "Puerto Casado", "department": "ALTO PARAGUAY", "rate": null},
        {"city": "Ciudad del Este", "department": "ALTO PARANA", "rate": 20000},
        {"city": "Doctor Juan León Mallorquín", "department": "ALTO PARANA", "rate": 30000},
        {"city": "Doctor Raúl Peña", "department": "ALTO PARANA", "rate": null},
        {"city": "Domingo Martínez de Irala", "department": "ALTO PARANA", "rate": null},
        {"city": "Hernandarias", "department": "ALTO PARANA", "rate": 25000},
        {"city": "Iruña", "department": "ALTO PARANA", "rate": null},
        {"city": "Itakyry", "department": "ALTO PARANA", "rate": null},
        {"city": "Juan Emilio O''Leary", "department": "ALTO PARANA", "rate": 30000},
        {"city": "Los Cedrales", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Mbaracayú", "department": "ALTO PARANA", "rate": null},
        {"city": "Minga Guazú", "department": "ALTO PARANA", "rate": 30000},
        {"city": "Minga Porá", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Naranjal", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Presidente Franco", "department": "ALTO PARANA", "rate": 25000},
        {"city": "San Alberto", "department": "ALTO PARANA", "rate": 35000},
        {"city": "San Cristóbal", "department": "ALTO PARANA", "rate": null},
        {"city": "Santa Fe del Paraná", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Santa Rita", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Santa Rosa del Monday", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Tavapy", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Yguazú", "department": "ALTO PARANA", "rate": 35000},
        {"city": "Ñacunday", "department": "ALTO PARANA", "rate": null},
        {"city": "Bella Vista Norte", "department": "AMAMBAY", "rate": null},
        {"city": "Capitán Bado", "department": "AMAMBAY", "rate": null},
        {"city": "Cerro Cora", "department": "AMAMBAY", "rate": null},
        {"city": "Karapaí", "department": "AMAMBAY", "rate": null},
        {"city": "Pedro Juan Caballero", "department": "AMAMBAY", "rate": 45000},
        {"city": "Zanja Pyta", "department": "AMAMBAY", "rate": null},
        {"city": "Asunción", "department": "ASUNCION", "rate": 25000},
        {"city": "Boquerón", "department": "BOQUERON", "rate": null},
        {"city": "Filadelfia", "department": "BOQUERON", "rate": null},
        {"city": "Loma Plata", "department": "BOQUERON", "rate": null},
        {"city": "Mariscal José Félix Estigarribia", "department": "BOQUERON", "rate": null},
        {"city": "3 de febrero", "department": "CAAGUAZU", "rate": null},
        {"city": "Caaguazú", "department": "CAAGUAZU", "rate": 30000},
        {"city": "Carayao", "department": "CAAGUAZU", "rate": null},
        {"city": "Coronel Oviedo", "department": "CAAGUAZU", "rate": 35000},
        {"city": "Dr. Cecilio Baez", "department": "CAAGUAZU", "rate": null},
        {"city": "Dr. J. Eulogio Estigarribia", "department": "CAAGUAZU", "rate": 35000},
        {"city": "Dr. Juan Manuel Frutos", "department": "CAAGUAZU", "rate": 35000},
        {"city": "Jose Domingo Ocampos", "department": "CAAGUAZU", "rate": 30000},
        {"city": "La Pastora", "department": "CAAGUAZU", "rate": null},
        {"city": "Mcal. Francisco Solano Lopez", "department": "CAAGUAZU", "rate": null},
        {"city": "Nueva Londres", "department": "CAAGUAZU", "rate": null},
        {"city": "Nueva Toledo", "department": "CAAGUAZU", "rate": null},
        {"city": "R.I. 3 Corrales", "department": "CAAGUAZU", "rate": null},
        {"city": "Raul Arsenio Oviedo", "department": "CAAGUAZU", "rate": null},
        {"city": "Repatriacion", "department": "CAAGUAZU", "rate": null},
        {"city": "San Joaquin", "department": "CAAGUAZU", "rate": null},
        {"city": "San Jose de los Arroyos", "department": "CAAGUAZU", "rate": null},
        {"city": "Santa Rosa del Mbutuy", "department": "CAAGUAZU", "rate": null},
        {"city": "Simon Bolivar", "department": "CAAGUAZU", "rate": null},
        {"city": "Tembiapora", "department": "CAAGUAZU", "rate": null},
        {"city": "Vaqueria", "department": "CAAGUAZU", "rate": null},
        {"city": "Yhu", "department": "CAAGUAZU", "rate": null},
        {"city": "3 de mayo", "department": "CAAZAPA", "rate": null},
        {"city": "Abai", "department": "CAAZAPA", "rate": null},
        {"city": "Buena Vista", "department": "CAAZAPA", "rate": null},
        {"city": "Caazapá", "department": "CAAZAPA", "rate": null},
        {"city": "Coronel Maciel", "department": "CAAZAPA", "rate": null},
        {"city": "Doctor Moises S. Bertoni", "department": "CAAZAPA", "rate": null},
        {"city": "Fulgencio Yegros", "department": "CAAZAPA", "rate": null},
        {"city": "General Higinio Morínigo", "department": "CAAZAPA", "rate": null},
        {"city": "San Juan Nepomuceno", "department": "CAAZAPA", "rate": null},
        {"city": "Tavaí", "department": "CAAZAPA", "rate": null},
        {"city": "Yuty", "department": "CAAZAPA", "rate": null},
        {"city": "Corpus Christi", "department": "CANINDEYU", "rate": null},
        {"city": "Curuguaty", "department": "CANINDEYU", "rate": null},
        {"city": "Gral. Francisco Caballero Álvarez", "department": "CANINDEYU", "rate": null},
        {"city": "Itanará", "department": "CANINDEYU", "rate": null},
        {"city": "Katueté", "department": "CANINDEYU", "rate": 35000},
        {"city": "La Paloma", "department": "CANINDEYU", "rate": 35000},
        {"city": "Laurel", "department": "CANINDEYU", "rate": null},
        {"city": "Maracaná", "department": "CANINDEYU", "rate": null},
        {"city": "Nueva Esperanza", "department": "CANINDEYU", "rate": 35000},
        {"city": "Pto. Adela", "department": "CANINDEYU", "rate": null},
        {"city": "Puente Kyha", "department": "CANINDEYU", "rate": 35000},
        {"city": "Salto del Guaira", "department": "CANINDEYU", "rate": null},
        {"city": "Villa Ygatimí", "department": "CANINDEYU", "rate": null},
        {"city": "Yasy Cañy", "department": "CANINDEYU", "rate": null},
        {"city": "Yby Pyta", "department": "CANINDEYU", "rate": null},
        {"city": "Ybyrarobaná", "department": "CANINDEYU", "rate": null},
        {"city": "Ypejhú", "department": "CANINDEYU", "rate": null},
        {"city": "Areguá", "department": "CENTRAL", "rate": 35000},
        {"city": "Capiatá", "department": "CENTRAL", "rate": 35000},
        {"city": "Fernando de la Mora", "department": "CENTRAL", "rate": 30000},
        {"city": "Guarambaré", "department": "CENTRAL", "rate": 35000},
        {"city": "Itauguá", "department": "CENTRAL", "rate": 35000},
        {"city": "Itá", "department": "CENTRAL", "rate": 35000},
        {"city": "J. Augusto Saldivar", "department": "CENTRAL", "rate": 30000},
        {"city": "Lambaré", "department": "CENTRAL", "rate": 25000},
        {"city": "Limpio", "department": "CENTRAL", "rate": 35000},
        {"city": "Luque", "department": "CENTRAL", "rate": 30000},
        {"city": "Mariano Roque Alonso", "department": "CENTRAL", "rate": 30000},
        {"city": "Nueva Italia", "department": "CENTRAL", "rate": 35000},
        {"city": "San Antonio", "department": "CENTRAL", "rate": 35000},
        {"city": "San Lorenzo", "department": "CENTRAL", "rate": 25000},
        {"city": "Villa Elisa", "department": "CENTRAL", "rate": 30000},
        {"city": "Villeta", "department": "CENTRAL", "rate": 30000},
        {"city": "Ypacaraí", "department": "CENTRAL", "rate": 35000},
        {"city": "Ypané", "department": "CENTRAL", "rate": 35000},
        {"city": "Ñemby", "department": "CENTRAL", "rate": 35000},
        {"city": "Arroyito", "department": "CONCEPCION", "rate": null},
        {"city": "Azote''y", "department": "CONCEPCION", "rate": null},
        {"city": "Belén", "department": "CONCEPCION", "rate": null},
        {"city": "Concepción", "department": "CONCEPCION", "rate": 45000},
        {"city": "Horqueta", "department": "CONCEPCION", "rate": 45000},
        {"city": "Loreto", "department": "CONCEPCION", "rate": null},
        {"city": "Paso Barreto", "department": "CONCEPCION", "rate": null},
        {"city": "Paso Horqueta", "department": "CONCEPCION", "rate": null},
        {"city": "Puerto Vallemi", "department": "CONCEPCION", "rate": null},
        {"city": "San Alfredo", "department": "CONCEPCION", "rate": null},
        {"city": "San Carlos del Apa", "department": "CONCEPCION", "rate": null},
        {"city": "San Lázaro", "department": "CONCEPCION", "rate": null},
        {"city": "Sargento Jose Felix Lopez", "department": "CONCEPCION", "rate": null},
        {"city": "Yby Yaú", "department": "CONCEPCION", "rate": null},
        {"city": "Altos", "department": "CORDILLERA", "rate": 35000},
        {"city": "Arroyos y Esteros", "department": "CORDILLERA", "rate": null},
        {"city": "Atyrá", "department": "CORDILLERA", "rate": 35000},
        {"city": "Caacupé", "department": "CORDILLERA", "rate": 35000},
        {"city": "Caraguatay", "department": "CORDILLERA", "rate": null},
        {"city": "Emboscada", "department": "CORDILLERA", "rate": null},
        {"city": "Eusebio Ayala", "department": "CORDILLERA", "rate": 35000},
        {"city": "Isla Pucú", "department": "CORDILLERA", "rate": null},
        {"city": "Itacurubí de la Cordillera", "department": "CORDILLERA", "rate": null},
        {"city": "Juan de Mena", "department": "CORDILLERA", "rate": null},
        {"city": "Loma Grande", "department": "CORDILLERA", "rate": null},
        {"city": "Mbocayaty del Yhaguy", "department": "CORDILLERA", "rate": null},
        {"city": "Nueva Colombia", "department": "CORDILLERA", "rate": null},
        {"city": "Piribebuy", "department": "CORDILLERA", "rate": 35000},
        {"city": "Primero de Marzo", "department": "CORDILLERA", "rate": null},
        {"city": "San Bernardino", "department": "CORDILLERA", "rate": 35000},
        {"city": "San José Obrero", "department": "CORDILLERA", "rate": 35000},
        {"city": "Santa Elena", "department": "CORDILLERA", "rate": null},
        {"city": "Tobatí", "department": "CORDILLERA", "rate": 35000},
        {"city": "Valenzuela", "department": "CORDILLERA", "rate": null},
        {"city": "Borja", "department": "GUAIRA", "rate": null},
        {"city": "Coronel Martinez", "department": "GUAIRA", "rate": null},
        {"city": "Doctor Botrell", "department": "GUAIRA", "rate": null},
        {"city": "Eugenio A. Garay", "department": "GUAIRA", "rate": null},
        {"city": "Félix Pérez Cardozo", "department": "GUAIRA", "rate": null},
        {"city": "Independencia", "department": "GUAIRA", "rate": null},
        {"city": "Itapé", "department": "GUAIRA", "rate": null},
        {"city": "Iturbe", "department": "GUAIRA", "rate": null},
        {"city": "Jose Mauricio Troche", "department": "GUAIRA", "rate": null},
        {"city": "José Fassardi", "department": "GUAIRA", "rate": null},
        {"city": "Mbocayaty del Guairá", "department": "GUAIRA", "rate": null},
        {"city": "Natalicio Talavera", "department": "GUAIRA", "rate": null},
        {"city": "Paso Yobai", "department": "GUAIRA", "rate": null},
        {"city": "San Salvador", "department": "GUAIRA", "rate": null},
        {"city": "Tebicuary", "department": "GUAIRA", "rate": null},
        {"city": "Villarrica", "department": "GUAIRA", "rate": 40000},
        {"city": "Yataity", "department": "GUAIRA", "rate": null},
        {"city": "Ñumi", "department": "GUAIRA", "rate": null},
        {"city": "Alto Vera", "department": "ITAPUA", "rate": null},
        {"city": "Bella Vista", "department": "ITAPUA", "rate": null},
        {"city": "Cambyreta", "department": "ITAPUA", "rate": null},
        {"city": "Capitan Meza", "department": "ITAPUA", "rate": null},
        {"city": "Capitan Miranda", "department": "ITAPUA", "rate": null},
        {"city": "Carlos Antonio López", "department": "ITAPUA", "rate": null},
        {"city": "Carmen del Parana", "department": "ITAPUA", "rate": null},
        {"city": "Coronel Bogado", "department": "ITAPUA", "rate": null},
        {"city": "Edelira", "department": "ITAPUA", "rate": null},
        {"city": "Encarnación", "department": "ITAPUA", "rate": 35000},
        {"city": "Fram", "department": "ITAPUA", "rate": null},
        {"city": "General Jose Maria Delgado", "department": "ITAPUA", "rate": null},
        {"city": "Gral. Artigas", "department": "ITAPUA", "rate": null},
        {"city": "Hohenau", "department": "ITAPUA", "rate": null},
        {"city": "Itapua Poty", "department": "ITAPUA", "rate": null},
        {"city": "Jesús de Tavarangué", "department": "ITAPUA", "rate": null},
        {"city": "Jose Leandro Oviedo", "department": "ITAPUA", "rate": null},
        {"city": "La Paz", "department": "ITAPUA", "rate": null},
        {"city": "Mayor Otaño", "department": "ITAPUA", "rate": null},
        {"city": "Natalio", "department": "ITAPUA", "rate": null},
        {"city": "Nueva Alborada", "department": "ITAPUA", "rate": null},
        {"city": "Obligado", "department": "ITAPUA", "rate": null},
        {"city": "Pirapo", "department": "ITAPUA", "rate": null},
        {"city": "San Cosme y Damián", "department": "ITAPUA", "rate": null},
        {"city": "San Juan del Paraná", "department": "ITAPUA", "rate": null},
        {"city": "San Pedro del Paraná", "department": "ITAPUA", "rate": null},
        {"city": "San Rafael del Parana", "department": "ITAPUA", "rate": null},
        {"city": "Tomas R. Pereira", "department": "ITAPUA", "rate": null},
        {"city": "Trinidad", "department": "ITAPUA", "rate": null},
        {"city": "Yatytay", "department": "ITAPUA", "rate": null},
        {"city": "Ayolas", "department": "MISIONES", "rate": null},
        {"city": "Maria Auxiliadora", "department": "MISIONES", "rate": null},
        {"city": "San Ignacio", "department": "MISIONES", "rate": null},
        {"city": "San Ignacio Guazú", "department": "MISIONES", "rate": null},
        {"city": "San Juan Bautista", "department": "MISIONES", "rate": null},
        {"city": "San Miguel", "department": "MISIONES", "rate": null},
        {"city": "San Patricio", "department": "MISIONES", "rate": null},
        {"city": "Santa María de Fé", "department": "MISIONES", "rate": null},
        {"city": "Santa Rosa Misiones", "department": "MISIONES", "rate": null},
        {"city": "Santiago", "department": "MISIONES", "rate": null},
        {"city": "Villa Florida", "department": "MISIONES", "rate": null},
        {"city": "Yabebyry", "department": "MISIONES", "rate": null},
        {"city": "Acahay", "department": "PARAGUARI", "rate": null},
        {"city": "Caapucú", "department": "PARAGUARI", "rate": null},
        {"city": "Carapeguá", "department": "PARAGUARI", "rate": null},
        {"city": "Escobar", "department": "PARAGUARI", "rate": null},
        {"city": "Gral. Bernardino Caballero", "department": "PARAGUARI", "rate": null},
        {"city": "La Colmena", "department": "PARAGUARI", "rate": null},
        {"city": "María Antonia", "department": "PARAGUARI", "rate": null},
        {"city": "Mbuyapey", "department": "PARAGUARI", "rate": null},
        {"city": "Paraguarí", "department": "PARAGUARI", "rate": 35000},
        {"city": "Pirayú", "department": "PARAGUARI", "rate": null},
        {"city": "Quiindy", "department": "PARAGUARI", "rate": null},
        {"city": "Quyquyhó", "department": "PARAGUARI", "rate": null},
        {"city": "San Roque González de Santa Cruz", "department": "PARAGUARI", "rate": null},
        {"city": "Sapucai", "department": "PARAGUARI", "rate": null},
        {"city": "Tebicuarymí", "department": "PARAGUARI", "rate": null},
        {"city": "Yaguarón", "department": "PARAGUARI", "rate": 35000},
        {"city": "Ybycuí", "department": "PARAGUARI", "rate": null},
        {"city": "Ybytymí", "department": "PARAGUARI", "rate": null},
        {"city": "Benjamin Aceval", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Campo Aceval", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Gral. Jose Maria Bruguez", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "José Falcón", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Nanawa", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Nueva Asunción", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Puerto Pinasco", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Tte. 1ro Manuel Irala Fernandez", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Tte. Esteban Martinez", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "Villa Hayes", "department": "PRESIDENTE HAYES", "rate": null},
        {"city": "25 de diciembre", "department": "SAN PEDRO", "rate": null},
        {"city": "Antequera", "department": "SAN PEDRO", "rate": null},
        {"city": "Capiibary", "department": "SAN PEDRO", "rate": null},
        {"city": "Choré", "department": "SAN PEDRO", "rate": null},
        {"city": "Gral. Elizardo Aquino", "department": "SAN PEDRO", "rate": null},
        {"city": "Gral. Resquín", "department": "SAN PEDRO", "rate": null},
        {"city": "Guayaibí", "department": "SAN PEDRO", "rate": null},
        {"city": "Itacurubí del Rosario", "department": "SAN PEDRO", "rate": null},
        {"city": "Liberación", "department": "SAN PEDRO", "rate": null},
        {"city": "Lima", "department": "SAN PEDRO", "rate": null},
        {"city": "Nueva Germania", "department": "SAN PEDRO", "rate": null},
        {"city": "San Estanislao", "department": "SAN PEDRO", "rate": null},
        {"city": "San José del Rosario", "department": "SAN PEDRO", "rate": null},
        {"city": "San Pablo", "department": "SAN PEDRO", "rate": null},
        {"city": "San Pedro de Ycuamandyyu", "department": "SAN PEDRO", "rate": null},
        {"city": "San Vicente Pancholo", "department": "SAN PEDRO", "rate": null},
        {"city": "Santa Rosa del Aguaray", "department": "SAN PEDRO", "rate": null},
        {"city": "Tacuatí", "department": "SAN PEDRO", "rate": null},
        {"city": "Unión", "department": "SAN PEDRO", "rate": null},
        {"city": "Villa del Rosario", "department": "SAN PEDRO", "rate": null},
        {"city": "Yataity del Norte", "department": "SAN PEDRO", "rate": null},
        {"city": "Yrybucuá", "department": "SAN PEDRO", "rate": null},
        {"city": "Alberdi", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Cerrito", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Desmochados", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Gral. José E. Díaz", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Guazucuá", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Humaitá", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Isla Umbú", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Laureles", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Mayor José D. Martínez", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Paso de Patria", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Pilar", "department": "ÑEEMBUCU", "rate": null},
        {"city": "San Juan Bautista del Ñeembucú", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Tacuaras", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Villa Franca", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Villa Oliva", "department": "ÑEEMBUCU", "rate": null},
        {"city": "Villalbin", "department": "ÑEEMBUCU", "rate": null}
    ]$json$::JSONB;

    -- Upsert via existing system function
    SELECT import_carrier_coverage(v_store_id, v_carrier_id, v_coverage) INTO v_count;

    SELECT COUNT(*) INTO v_with_rate
    FROM carrier_coverage
    WHERE carrier_id = v_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'MIGRATION 149 COMPLETED';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Store:     SOLENNE (%)', v_store_id;
    RAISE NOTICE 'Carrier:   Lucero del Este (%)', v_carrier_id;
    RAISE NOTICE 'Entries imported: %', v_count;
    RAISE NOTICE 'With rate (has coverage): %', v_with_rate;
    RAISE NOTICE '================================================';
END $$;

-- Verification block
DO $$
DECLARE
    v_store_id UUID := '0b3f13f8-d1dc-48a5-a707-27a095c9c545';
    v_carrier_id UUID;
    v_total INT;
    v_rated INT;
    v_asuncion_rate DECIMAL(12,2);
    v_luque_rate DECIMAL(12,2);
    v_cde_rate DECIMAL(12,2);
BEGIN
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) LIKE '%lucero del este%'
      AND is_active = TRUE
    LIMIT 1;

    SELECT COUNT(*) INTO v_total
    FROM carrier_coverage
    WHERE carrier_id = v_carrier_id AND is_active = TRUE;

    SELECT COUNT(*) INTO v_rated
    FROM carrier_coverage
    WHERE carrier_id = v_carrier_id AND is_active = TRUE AND rate IS NOT NULL;

    v_asuncion_rate := get_carrier_rate_for_city(v_carrier_id, 'Asunción');
    v_luque_rate    := get_carrier_rate_for_city(v_carrier_id, 'Luque');
    v_cde_rate      := get_carrier_rate_for_city(v_carrier_id, 'Ciudad del Este');

    RAISE NOTICE '--- VERIFICATION ---';
    RAISE NOTICE 'Total entries: %', v_total;
    RAISE NOTICE 'With rate:     %', v_rated;
    RAISE NOTICE 'Asuncion:       % Gs', v_asuncion_rate;
    RAISE NOTICE 'Luque:          % Gs', v_luque_rate;
    RAISE NOTICE 'Ciudad del Este: % Gs', v_cde_rate;

    IF v_total <> 266 THEN
        RAISE WARNING 'Expected 266 entries, got %', v_total;
    END IF;
    IF v_rated < 59 THEN
        RAISE WARNING 'Expected >= 59 rated entries, got %', v_rated;
    END IF;
    IF v_asuncion_rate IS NULL OR v_luque_rate IS NULL OR v_cde_rate IS NULL THEN
        RAISE EXCEPTION 'Rate lookup failed for core cities';
    END IF;
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 149 COMPLETED
-- ================================================================
-- Created/ensured carrier "Lucero del Este" for SOLENNE
-- Imported 266 coverage entries (59 with rate, 207 null=no coverage)
-- Rates source: NOCTE production (same carrier, cloned 2026-04-11)
-- ================================================================
