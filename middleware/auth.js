/* ===== middleware/auth.js ===== */

const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret';
}

function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '24h' });
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, getSecret());
    req.adminUser = { id: decoded.sub, username: decoded.username, displayName: decoded.displayName || decoded.username, role: decoded.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireSuperAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.adminUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden: superadmin only' });
    }
    next();
  });
}

module.exports = { requireAdmin, requireSuperAdmin, signToken };
