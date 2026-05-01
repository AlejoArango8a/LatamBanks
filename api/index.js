// Vercel Serverless entry point.
// Pre-parse JSON body so Express can read req.body correctly in serverless context.
const app = require('../backend/server');

module.exports = async (req, res) => {
  // If Vercel hasn't pre-parsed the body yet, do it manually
  if (req.body === undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    await new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json') && raw) {
          try { req.body = JSON.parse(raw); } catch { req.body = {}; }
        } else {
          req.body = {};
        }
        resolve();
      });
      req.on('error', () => { req.body = {}; resolve(); });
    });
  }
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    app(req, res);
  });
};
