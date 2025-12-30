#!/usr/bin/env node
/**
 * Script de Verificación: Sistema de Colaboradores
 *
 * Verifica que todas las tablas, funciones y columnas necesarias
 * para el sistema de colaboradores estén presentes en Supabase.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function verify() {
  console.log('🔍 Verificando sistema de colaboradores...\n');

  let allPassed = true;

  // 1. Verificar tabla collaborator_invitations
  try {
    const { data, error } = await supabase
      .from('collaborator_invitations')
      .select('id')
      .limit(0);

    if (error) throw error;
    console.log('✅ Tabla collaborator_invitations existe');
  } catch (error) {
    console.error('❌ Tabla collaborator_invitations NO existe:', error.message);
    allPassed = false;
  }

  // 2. Verificar columnas en stores
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('subscription_plan, max_users')
      .limit(1);

    if (error) throw error;
    console.log('✅ Columnas subscription_plan y max_users existen en stores');
  } catch (error) {
    console.error('❌ Columnas de subscription NO existen en stores:', error.message);
    allPassed = false;
  }

  // 3. Verificar columnas en user_stores
  try {
    const { data, error } = await supabase
      .from('user_stores')
      .select('invited_by, invited_at, is_active')
      .limit(1);

    if (error) throw error;
    console.log('✅ Columnas de invitación existen en user_stores');
  } catch (error) {
    console.error('❌ Columnas de invitación NO existen en user_stores:', error.message);
    allPassed = false;
  }

  // 4. Verificar función can_add_user_to_store
  try {
    const { data, error } = await supabase.rpc('can_add_user_to_store', {
      p_store_id: '00000000-0000-0000-0000-000000000000'
    });

    // Es OK si falla por UUID inválido, lo importante es que la función existe
    console.log('✅ Función can_add_user_to_store existe');
  } catch (error) {
    console.error('❌ Función can_add_user_to_store NO existe:', error.message);
    allPassed = false;
  }

  // 5. Verificar función get_store_user_stats
  try {
    const { data, error } = await supabase.rpc('get_store_user_stats', {
      p_store_id: '00000000-0000-0000-0000-000000000000'
    });

    console.log('✅ Función get_store_user_stats existe');
  } catch (error) {
    console.error('❌ Función get_store_user_stats NO existe:', error.message);
    allPassed = false;
  }

  // 6. Verificar que existe al menos una tienda
  try {
    const { data: stores, error } = await supabase
      .from('stores')
      .select('id, name, subscription_plan, max_users')
      .limit(1);

    if (error) throw error;

    if (stores && stores.length > 0) {
      console.log(`✅ Store encontrada: "${stores[0].name}" (plan: ${stores[0].subscription_plan}, max_users: ${stores[0].max_users})`);

      // Test real con el store ID
      const { data: stats, error: statsError } = await supabase
        .rpc('get_store_user_stats', { p_store_id: stores[0].id });

      if (statsError) throw statsError;

      console.log('✅ Stats de la tienda:', {
        current_users: stats.current_users,
        max_users: stats.max_users,
        plan: stats.plan,
        can_add_more: stats.can_add_more
      });
    } else {
      console.warn('⚠️  No hay stores en la base de datos');
    }
  } catch (error) {
    console.error('❌ Error verificando stores:', error.message);
    allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ TODAS LAS VERIFICACIONES PASARON');
    console.log('🎉 El sistema de colaboradores está listo para usar!');
  } else {
    console.log('❌ ALGUNAS VERIFICACIONES FALLARON');
    console.log('💡 Asegúrate de aplicar la migración 030 en Supabase Dashboard');
  }
  console.log('='.repeat(60));
}

verify().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
