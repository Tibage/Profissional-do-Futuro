const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = cleanEnv(process.env.DATABASE_URL);
const ADMIN_USERNAME = cleanEnv(process.env.ADMIN_USERNAME);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);
const SESSION_SECRET = cleanEnv(process.env.SESSION_SECRET);
const TABLE_NAME = cleanEnv(process.env.DB_TABLE) || "Profissional do futuro";
const ALLOWED_ORIGIN = cleanEnv(process.env.ALLOWED_ORIGIN);
const SESSION_TTL_MS = envNumber("SESSION_TTL_MS", 1000 * 60 * 60 * 8);
const MAX_BODY_BYTES = envNumber("MAX_BODY_BYTES", 1024 * 1024);
const RATE_LIMIT_WINDOW_MS = envNumber("RATE_LIMIT_WINDOW_MS", 60 * 1000);
const PUBLIC_RATE_LIMIT = envNumber("PUBLIC_RATE_LIMIT", 60);
const ADMIN_RATE_LIMIT = envNumber("ADMIN_RATE_LIMIT", 180);
const COOKIE_SECURE = cleanEnv(process.env.SESSION_COOKIE_SECURE) === "true";

const sessions = new Map();
const rateBuckets = new Map();
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function cleanEnv(value) {
  return String(value || "").trim();
}

function envNumber(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const envContent = fs.readFileSync(filePath, "utf8");
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function withSecurityHeaders(headers = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
    ...headers
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, withSecurityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  }));
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  response.writeHead(statusCode, withSecurityHeaders({
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  }));
  response.end(message);
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return request.socket.remoteAddress || "unknown";
}

function rateLimit(request, response, keyPrefix, maxRequests) {
  const key = `${keyPrefix}:${getClientIp(request)}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  bucket.count += 1;
  if (bucket.count <= maxRequests) return true;

  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
  sendJson(response, 429, {
    message: "Muitas requisicoes em pouco tempo. Tente novamente em alguns segundos."
  }, {
    "Retry-After": String(retryAfter)
  });
  return false;
}

function clearExpiredState() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }

  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt < now) {
      rateBuckets.delete(key);
    }
  }
}

function getCookies(request) {
  const header = request.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    if (!name) return;
    cookies[name] = decodeURIComponent(rest.join("="));
  });

  return cookies;
}

function getSessionToken(request) {
  return getCookies(request).pf_admin_session || "";
}

function signSession(raw) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(raw)
    .digest("hex");
}

function isValidSignedToken(token) {
  const [raw, signature] = token.split(".");
  if (!raw || !signature || !SESSION_SECRET) return false;

  const expected = signSession(raw);
  return safeEqual(signature, expected);
}

function isAuthenticated(request) {
  const token = getSessionToken(request);
  if (!token || !isValidSignedToken(token)) return false;

  const session = sessions.get(token);
  if (!session) return false;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function createSession() {
  const raw = crypto.randomBytes(32).toString("hex");
  const token = `${raw}.${signSession(raw)}`;
  sessions.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function buildSessionCookie(value, maxAgeSeconds) {
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `pf_admin_session=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function validateServerConfig() {
  const missing = [];

  if (!DATABASE_URL) missing.push("DATABASE_URL");
  if (!ADMIN_USERNAME) missing.push("ADMIN_USERNAME");
  if (!ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");

  return missing;
}

function getMissingDatabaseConfig() {
  const missing = [];

  if (!DATABASE_URL) missing.push("DATABASE_URL");

  return missing;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function isValidCpf(cpf) {
  const normalized = normalizeCpf(cpf);
  if (normalized.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(normalized)) return false;

  const digits = normalized.split("").map(Number);
  const firstSum = digits.slice(0, 9).reduce((sum, digit, index) => {
    return sum + digit * (10 - index);
  }, 0);
  const firstCheck = (firstSum * 10) % 11;
  if ((firstCheck === 10 ? 0 : firstCheck) !== digits[9]) return false;

  const secondSum = digits.slice(0, 10).reduce((sum, digit, index) => {
    return sum + digit * (11 - index);
  }, 0);
  const secondCheck = (secondSum * 10) % 11;
  return (secondCheck === 10 ? 0 : secondCheck) === digits[10];
}

function requireValidCpf(cpf) {
  if (!isValidCpf(cpf)) {
    const error = new Error("Informe um CPF valido com 11 numeros.");
    error.statusCode = 400;
    throw error;
  }
}

function sanitizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    const error = new Error("Informe uma pontuacao inteira e maior ou igual a zero.");
    error.statusCode = 400;
    throw error;
  }
  return score;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Payload muito grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("JSON invalido.");
    error.statusCode = 400;
    throw error;
  }
}

function quoteIdentifier(identifier) {
  if (!identifier || identifier.includes("\0")) {
    throw new Error("Nome de tabela invalido.");
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableIdentifier() {
  return quoteIdentifier(TABLE_NAME);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

async function dbQuery(text, params = []) {
  if (!db) {
    const error = new Error("Banco de dados nao configurado.");
    error.statusCode = 500;
    throw error;
  }

  try {
    const result = await db.query(text, params);
    return result.rows;
  } catch (cause) {
    const error = new Error(cause.message || "Erro ao consultar o banco de dados.");
    error.statusCode = "code" in cause && String(cause.code).startsWith("23") ? 409 : 502;
    throw error;
  }
}

async function buscarPontuacaoPorCpf(cpf) {
  const rows = await dbQuery(
    `select nome, pontuacao from ${tableIdentifier()} where cpf = $1 limit 1`,
    [cpf]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

async function buscarAlunoPorCpf(cpf) {
  const rows = await dbQuery(
    `select nome, cpf, pontuacao from ${tableIdentifier()} where cpf = $1 limit 1`,
    [cpf]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

async function listarAlunos({ search, page, pageSize }) {
  const offset = (page - 1) * pageSize;
  let whereClause = "";
  const values = [];

  const cleanSearch = sanitizeName(search);
  if (cleanSearch) {
    const cpfSearch = normalizeCpf(cleanSearch);
    if (cpfSearch.length >= 3) {
      values.push(`%${cpfSearch}%`);
      whereClause = `where cpf like $${values.length}`;
    } else {
      values.push(`%${escapeLike(cleanSearch)}%`);
      whereClause = `where nome ilike $${values.length} escape '\\'`;
    }
  }

  values.push(pageSize, offset);
  const rows = await dbQuery(
    `select nome, cpf, pontuacao
       from ${tableIdentifier()}
       ${whereClause}
      order by nome asc
      limit $${values.length - 1}
     offset $${values.length}`,
    values
  );

  return {
    page,
    pageSize,
    alunos: rows || []
  };
}

async function salvarOuAtualizarAluno({ nome, cpf, pontuacao }) {
  const aluno = await buscarAlunoPorCpf(cpf);

  if (aluno) {
    const pontuacaoAtual = Number(aluno.pontuacao) || 0;
    const novaPontuacao = pontuacaoAtual + pontuacao;

    await dbQuery(
      `update ${tableIdentifier()} set nome = $1, pontuacao = $2 where cpf = $3`,
      [nome, novaPontuacao, cpf]
    );
    return { action: "atualizado", total: novaPontuacao, adicionado: pontuacao };
  }

  await dbQuery(
    `insert into ${tableIdentifier()} (nome, cpf, pontuacao) values ($1, $2, $3)`,
    [nome, cpf, pontuacao]
  );
  return { action: "cadastrado", total: pontuacao, adicionado: pontuacao };
}

async function substituirAluno(cpf, body) {
  const nome = sanitizeName(body.nome);
  if (!nome) {
    const error = new Error("Informe o nome do aluno.");
    error.statusCode = 400;
    throw error;
  }

  const pontuacao = sanitizeScore(body.pontuacao);

  await dbQuery(
    `update ${tableIdentifier()} set nome = $1, pontuacao = $2 where cpf = $3`,
    [nome, pontuacao, cpf]
  );

  return { nome, cpf, pontuacao };
}

async function removerAluno(cpf) {
  await dbQuery(`delete from ${tableIdentifier()} where cpf = $1`, [cpf]);
}

function parsePagination(url) {
  const requestedPage = Number(url.searchParams.get("page") || 1);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const requestedPageSize = Number(url.searchParams.get("pageSize") || 25);
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(100, Math.max(1, requestedPageSize))
    : 25;

  return { page, pageSize };
}

function matchCpfRoute(pathname, prefix) {
  const base = `${prefix}/`;
  if (!pathname.startsWith(base)) return null;

  const cpf = normalizeCpf(decodeURIComponent(pathname.slice(base.length)));
  return cpf.length === 11 ? cpf : null;
}

function assertDatabaseConfigured(response) {
  const missingDatabaseConfig = getMissingDatabaseConfig();
  if (missingDatabaseConfig.length === 0) return true;

  sendJson(response, 500, {
    message: `Servidor incompleto. Configure: ${missingDatabaseConfig.join(", ")} no arquivo .env.`
  });
  return false;
}

function assertAdminAuthenticated(request, response) {
  if (isAuthenticated(request)) return true;

  sendJson(response, 401, { message: "Sessao administrativa invalida." });
  return false;
}

async function handlePublicRoutes(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "profissional-do-futuro",
      databaseConfigured: getMissingDatabaseConfig().length === 0
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/pontuacao") {
    if (!rateLimit(request, response, "public:pontuacao", PUBLIC_RATE_LIMIT)) return true;
    if (!assertDatabaseConfigured(response)) return true;

    const cpf = normalizeCpf(url.searchParams.get("cpf"));
    requireValidCpf(cpf);

    const aluno = await buscarPontuacaoPorCpf(cpf);
    if (!aluno) {
      sendJson(response, 404, { message: "Nenhuma pontuacao encontrada para este CPF." });
      return true;
    }

    sendJson(response, 200, aluno);
    return true;
  }

  return false;
}

async function handleAdminAuthRoutes(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    sendJson(response, 200, { authenticated: isAuthenticated(request) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    if (!rateLimit(request, response, "admin:login", 10)) return true;

    const missingAdminConfig = [];
    if (!ADMIN_USERNAME) missingAdminConfig.push("ADMIN_USERNAME");
    if (!ADMIN_PASSWORD) missingAdminConfig.push("ADMIN_PASSWORD");
    if (!SESSION_SECRET) missingAdminConfig.push("SESSION_SECRET");

    if (missingAdminConfig.length > 0) {
      sendJson(response, 500, {
        message: `Servidor incompleto. Configure: ${missingAdminConfig.join(", ")} no arquivo .env.`
      });
      return true;
    }

    const body = await readJsonBody(request);
    const username = sanitizeName(body.username).toLowerCase();
    const password = String(body.password || "").trim();
    const expectedUsername = ADMIN_USERNAME.toLowerCase();
    const expectedPassword = ADMIN_PASSWORD;

    if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
      sendJson(response, 401, { message: "Usuario ou senha invalidos." });
      return true;
    }

    const token = createSession();
    sendJson(response, 200, { authenticated: true }, {
      "Set-Cookie": buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = getSessionToken(request);
    if (token) {
      sessions.delete(token);
    }

    sendJson(response, 200, { authenticated: false }, {
      "Set-Cookie": buildSessionCookie("", 0)
    });
    return true;
  }

  return false;
}

async function handleAdminAlunoRoutes(request, response, url) {
  if (!url.pathname.startsWith("/api/admin/alunos")) return false;
  if (!rateLimit(request, response, "admin:api", ADMIN_RATE_LIMIT)) return true;
  if (!assertDatabaseConfigured(response)) return true;
  if (!assertAdminAuthenticated(request, response)) return true;

  const routeCpf = matchCpfRoute(url.pathname, "/api/admin/alunos");

  if (request.method === "GET" && url.pathname === "/api/admin/alunos") {
    const pagination = parsePagination(url);
    const data = await listarAlunos({
      search: url.searchParams.get("search") || "",
      ...pagination
    });
    sendJson(response, 200, data);
    return true;
  }

  if (request.method === "GET" && routeCpf) {
    requireValidCpf(routeCpf);
    const aluno = await buscarAlunoPorCpf(routeCpf);
    if (!aluno) {
      sendJson(response, 404, { message: "Aluno nao encontrado." });
      return true;
    }

    sendJson(response, 200, aluno);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/alunos") {
    const body = await readJsonBody(request);
    const nome = sanitizeName(body.nome);
    const cpf = normalizeCpf(body.cpf);
    const pontuacao = sanitizeScore(body.pontuacao);

    if (!nome) {
      sendJson(response, 400, { message: "Informe o nome do aluno." });
      return true;
    }

    requireValidCpf(cpf);

    const resultado = await salvarOuAtualizarAluno({ nome, cpf, pontuacao });
    sendJson(response, 200, { ok: true, ...resultado });
    return true;
  }

  if (request.method === "PUT" && routeCpf) {
    requireValidCpf(routeCpf);
    const alunoAtualizado = await substituirAluno(routeCpf, await readJsonBody(request));
    sendJson(response, 200, { ok: true, aluno: alunoAtualizado });
    return true;
  }

  if (request.method === "DELETE" && routeCpf) {
    requireValidCpf(routeCpf);
    await removerAluno(routeCpf);
    sendJson(response, 200, { ok: true });
    return true;
  }

  sendJson(response, 405, { message: "Metodo nao permitido para esta rota." });
  return true;
}

function serveStaticFile(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : decodeURIComponent(request.url.split("?")[0]);
  const safePath = path.normalize(path.join(ROOT_DIR, requestPath));

  if (!safePath.startsWith(ROOT_DIR)) {
    sendText(response, 403, "Acesso negado.");
    return;
  }

  fs.readFile(safePath, (error, fileBuffer) => {
    if (error) {
      sendText(response, 404, "Arquivo nao encontrado.");
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    response.writeHead(200, withSecurityHeaders({
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    }));
    response.end(fileBuffer);
  });
}

function applyCors(request, response) {
  if (!ALLOWED_ORIGIN) return false;

  const origin = request.headers.origin;
  if (origin !== ALLOWED_ORIGIN) return false;

  response.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Credentials", "true");

  if (request.method === "OPTIONS") {
    response.writeHead(204, withSecurityHeaders({
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }));
    response.end();
    return true;
  }

  return false;
}

async function handleRequest(request, response) {
  clearExpiredState();

  try {
    if (applyCors(request, response)) return;

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (await handlePublicRoutes(request, response, url)) return;
    if (await handleAdminAuthRoutes(request, response, url)) return;
    if (await handleAdminAlunoRoutes(request, response, url)) return;

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { message: "Rota nao encontrada." });
      return;
    }

    serveStaticFile(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, error.statusCode || 500, {
      message: error.message || "Erro interno do servidor."
    });
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    const missingConfig = validateServerConfig();
    console.log(`Servidor iniciado em http://localhost:${PORT}`);

    if (missingConfig.length > 0) {
      console.log(`Pendencias no .env: ${missingConfig.join(", ")}`);
    }
  });
}

module.exports = handleRequest;
