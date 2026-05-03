const prisma = require('../db/prisma');
const logger = require('../lib/logger');

/**
 * Write an audit log entry. Failures are logged but never thrown
 * — audit logging must not break the request path.
 */
async function audit({ userId = null, action, metadata = null, req = null }) {
  try {
    const ipAddress =
      req?.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;
    const userAgent = req?.headers['user-agent'] || null;

    await prisma.auditLog.create({
      data: {
        userId,
        action,
        metadata: metadata ?? undefined,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    logger.warn({ err: err.message, action, userId }, 'audit_log_write_failed');
  }
}

module.exports = { audit };
