/* ===== middleware/auth.js ===== */

const { makeToken } = require('../routes/auth');

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!token || !adminPassword || token !== makeToken(adminPassword)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdmin };
