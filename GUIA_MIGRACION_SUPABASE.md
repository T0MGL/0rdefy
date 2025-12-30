# 🔄 Guía de Migración a Supabase Oficial

## Estado Actual

- ✅ Proyecto creado: `vgqecqqleuowvoimcoxg`
- ✅ URL del proyecto: `https://vgqecqqleuowvoimcoxg.supabase.co`
- ⏳ **Pendiente**: Obtener credenciales correctas y aplicar migración

## Paso 1: Obtener Credenciales Correctas

### Opción A: Connection String (Recomendado para migración)

1. Ve al dashboard de Supabase:
   ```
   https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/settings/database
   ```

2. En la sección **"Connection string"**, busca:
   - **Transaction mode** (puerto 6543) ← Recomendado para la app
   - **Session mode** (puerto 5432) ← Recomendado para migraciones

3. Copia la URI completa. Debe verse así:
   ```
   postgresql://postgres.vgqecqqleuowvoimcoxg:[TU-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

4. **IMPORTANTE**: Reemplaza `[TU-PASSWORD]` con la contraseña REAL de la base de datos
   - Si no la recuerdas, puedes resetearla en: Settings → Database → Reset database password

### Opción B: JWT Keys (Para la aplicación)

1. Ve a:
   ```
   https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/settings/api
   ```

2. Copia las siguientes keys (empiezan con `eyJ...`):
   - **anon / public** key → Para `SUPABASE_ANON_KEY`
   - **service_role** key → Para `SUPABASE_SERVICE_ROLE_KEY`

## Paso 2: Aplicar Migración MASTER

### Método 1: Usando psql (Más rápido)

Una vez que tengas la connection string:

```bash
# Exportar la connection string
export SUPABASE_DB_URL="postgresql://postgres...@...supabase.com:5432/postgres"

# Aplicar migración
./scripts/apply-migration-with-connection-string.sh
```

### Método 2: Usando SQL Editor de Supabase (Alternativa)

Si la conexión directa no funciona:

1. Ve a:
   ```
   https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql/new
   ```

2. Abre el archivo local:
   ```
   db/migrations/000_MASTER_MIGRATION.sql
   ```

3. Copia TODO el contenido del archivo

4. Pégalo en el SQL Editor de Supabase

5. Haz clic en **"Run"** (▶️)

6. Espera 30-90 segundos hasta que complete

## Paso 3: Verificar Migración

Después de aplicar la migración, verifica que se crearon las tablas:

```bash
# Usando psql
psql "$SUPABASE_DB_URL" -c "\dt"

# O desde el SQL Editor:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Deberías ver al menos estas tablas principales:
- stores
- users
- products
- customers
- orders
- order_line_items
- picking_sessions
- return_sessions
- shopify_integrations
- (y muchas más...)

## Paso 4: Actualizar Variables de Entorno

Una vez que la migración esté aplicada:

```bash
# Backup del .env actual
cp .env .env.backup

# Actualizar con nuevas credenciales
# (El script te ayudará con esto)
```

Las variables que cambiarán:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Paso 5: Verificar Aplicación

```bash
# Backend
cd api
npm run dev

# Frontend (en otra terminal)
npm run dev
```

Verifica que:
- ✅ La app se conecta a la nueva DB
- ✅ Puedes hacer login
- ✅ Las queries funcionan correctamente

## Troubleshooting

### Error: "connection timeout"
- Verifica que las conexiones directas estén habilitadas en Settings → Database
- Usa la connection string correcta (session mode para migraciones)

### Error: "Invalid API key"
- Asegúrate de estar usando las JWT keys correctas (empiezan con `eyJ`)
- No uses las keys con formato `sb_secret_*`, esas no son las correctas

### Error: "password authentication failed"
- Resetea la contraseña en Settings → Database → Reset database password
- Actualiza la connection string con la nueva contraseña

## Contacto de Emergencia

Si tienes problemas, puedes:
1. Revisar los logs en: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/logs/explorer
2. Usar el chat de soporte de Supabase
3. Verificar el status: https://status.supabase.com/
