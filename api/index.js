// Vercel Serverless entry point — re-exports the Express app.
// Vercel detecta que es un módulo Express y lo adapta automáticamente.
module.exports = require('../backend/server');
