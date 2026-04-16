/* ===== middleware/auth.js ===== */

const { validTokens } = require('../routes/auth');

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdmin };
