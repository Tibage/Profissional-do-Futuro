const handleRequest = require("../server");

// A funcao dinamica recebe o caminho original (/api/admin/login, /api/ranking etc.).
// Assim o servidor consegue identificar cada rota corretamente na Vercel.
module.exports = handleRequest;
