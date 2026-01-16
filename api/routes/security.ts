import express from 'express';
import { verifyToken } from '../middleware/auth';
import {
  getUserSessions,
  terminateSession,
  terminateAllSessions,
  getUserActivity,
  logActivity
} from '../services/security.service';

const router = express.Router();

// ============================================
// SESSION MANAGEMENT ENDPOINTS
// ============================================

/**
 * GET /api/security/sessions
 * Get all active sessions for the current user
 */
router.get('/sessions', verifyToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;

    const sessions = await getUserSessions(userId);

    // Mark current session (based on token)
    const currentToken = req.headers.authorization?.replace('Bearer ', '');
    const enrichedSessions = sessions.map(session => ({
      ...session,
      isCurrent: false // We'll determine this on frontend by comparing lastActivity
    }));

    res.json({
      success: true,
      data: enrichedSessions
    });
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener sesiones'
    });
  }
});

/**
 * DELETE /api/security/sessions/:sessionId
 * Terminate a specific session
 */
router.delete('/sessions/:sessionId', verifyToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const { sessionId } = req.params;

    await terminateSession(sessionId, userId);

    // Log the activity
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    await logActivity({
      userId,
      actionType: 'session_terminated',
      description: `Sesión remota terminada manualmente`,
      metadata: { sessionId },
      ipAddress,
      userAgent
    });

    res.json({
      success: true,
      message: 'Session terminated successfully'
    });
  } catch (error) {
    console.error('Error terminating session:', error);
    res.status(500).json({
      success: false,
      error: 'Error al terminar sesión'
    });
  }
});

/**
 * DELETE /api/security/sessions
 * Terminate all sessions except the current one
 */
router.delete('/sessions', verifyToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const currentToken = req.headers.authorization?.replace('Bearer ', '');

    await terminateAllSessions(userId, currentToken);

    // Log the activity
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    await logActivity({
      userId,
      actionType: 'logout_all',
      description: `Todas las sesiones remotas fueron cerradas`,
      ipAddress,
      userAgent
    });

    res.json({
      success: true,
      message: 'All other sessions terminated successfully'
    });
  } catch (error) {
    console.error('Error terminating all sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Error al terminar sesiones'
    });
  }
});

// ============================================
// ACTIVITY LOG ENDPOINTS
// ============================================

/**
 * GET /api/security/activity
 * Get activity log for the current user
 */
router.get('/activity', verifyToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const activities = await getUserActivity(userId, limit, offset);

    res.json({
      success: true,
      data: activities,
      pagination: {
        limit,
        offset,
        total: activities.length
      }
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registro de actividad'
    });
  }
});

/**
 * GET /api/security/activity/recent
 * Get recent critical activities (last 10)
 */
router.get('/activity/recent', verifyToken, async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;

    const activities = await getUserActivity(userId, 10, 0);

    // Filter for important activity types
    const criticalTypes = [
      'login',
      'failed_login',
      'logout_all',
      'session_terminated',
      'password_change',
      'email_change',
      'account_deleted',
      'suspicious_activity'
    ];

    const criticalActivities = activities.filter(activity =>
      criticalTypes.includes(activity.action_type)
    );

    res.json({
      success: true,
      data: criticalActivities
    });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener actividad reciente'
    });
  }
});

export default router;
