const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");
const sessions = new Map();

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const TABLE_NAME = process.env.SUPABASE_TABLE || "Profissional do futuro";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

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

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
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

function isAuthenticated(request) {
  const token = getSessionToken(request);
  if (!token) return false;

  const session = sessions.get(token);
  if (!session) return false;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function createSession() {
  const raw = crypto.randomBytes(32).toString("hex");
  const signed = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(raw)
    .digest("hex");

  const token = `${raw}.${signed}`;
  sessions.set(token, { expiresAt: Date.now() + 1000 * 60 * 60 * 8 });
  return token;
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

function validateServerConfig() {
  const missing = [];

  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ADMIN_USERNAME) missing.push("ADMIN_USERNAME");
  if (!ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");

  return missing;
}

function getMissingSupabaseConfig() {
  const missing = [];

  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return missing;
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("JSON invalido.");
  }
}

async function supabaseRequest(method, endpoint, body) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || "Erro ao consultar o Supabase.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

function buildTablePath(query = "") {
  return `${encodeURIComponent(TABLE_NAME)}${query}`;
}

async function buscarPontuacaoPorCpf(cpf) {
  const query = `?select=nome,pontuacao&cpf=eq.${encodeURIComponent(cpf)}&limit=1`;
  const rows = await supabaseRequest("GET", buildTablePath(query));
  return rows && rows.length > 0 ? rows[0] : null;
}

async function salvarOuAtualizarAluno({ nome, cpf, pontuacao }) {
  const busca = await supabaseRequest(
    "GET",
    buildTablePath(`?select=cpf,pontuacao&cpf=eq.${encodeURIComponent(cpf)}&limit=1`)
  );

  if (busca && busca.length > 0) {
    const pontuacaoAtual = Number(busca[0].pontuacao) || 0;
    const novaPontuacao = pontuacaoAtual + pontuacao;

    await supabaseRequest(
      "PATCH",
      buildTablePath(`?cpf=eq.${encodeURIComponent(cpf)}`),
      { nome, pontuacao: novaPontuacao }
    );
    return { action: "atualizado", total: novaPontuacao, adicionado: pontuacao };
  }

  await supabaseRequest("POST", buildTablePath(), [{ nome, cpf, pontuacao }]);
  return { action: "cadastrado", total: pontuacao, adicionado: pontuacao };
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
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    response.end(fileBuffer);
  });
}

async function handleRequest(request, response) {
  clearExpiredSessions();

  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/pontuacao") {
      const missingSupabaseConfig = getMissingSupabaseConfig();
      if (missingSupabaseConfig.length > 0) {
        sendJson(response, 500, {
          message: `Servidor incompleto. Configure: ${missingSupabaseConfig.join(", ")} no arquivo .env.`
        });
        return;
      }

      const cpf = (url.searchParams.get("cpf") || "").replace(/\D/g, "");
      if (cpf.length !== 11) {
        sendJson(response, 400, { message: "Informe um CPF com 11 numeros." });
        return;
      }

      const aluno = await buscarPontuacaoPorCpf(cpf);
      if (!aluno) {
        sendJson(response, 404, { message: "Nenhuma pontuacao encontrada para este CPF." });
        return;
      }

      sendJson(response, 200, aluno);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/session") {
      sendJson(response, 200, { authenticated: isAuthenticated(request) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      const missingAdminConfig = [];
      if (!ADMIN_USERNAME) missingAdminConfig.push("ADMIN_USERNAME");
      if (!ADMIN_PASSWORD) missingAdminConfig.push("ADMIN_PASSWORD");
      if (!SESSION_SECRET) missingAdminConfig.push("SESSION_SECRET");

      if (missingAdminConfig.length > 0) {
        sendJson(response, 500, {
          message: `Servidor incompleto. Configure: ${missingAdminConfig.join(", ")} no arquivo .env.`
        });
        return;
      }

      const body = await readJsonBody(request);
      const username = (body.username || "").trim();
      const password = body.password || "";

      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        sendJson(response, 401, { message: "Usuario ou senha invalidos." });
        return;
      }

      const token = createSession();
      sendJson(
        response,
        200,
        { authenticated: true },
        {
          "Set-Cookie": `pf_admin_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
        }
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      const token = getSessionToken(request);
      if (token) {
        sessions.delete(token);
      }

      sendJson(
        response,
        200,
        { authenticated: false },
        {
          "Set-Cookie": "pf_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        }
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/alunos") {
      const missingSupabaseConfig = getMissingSupabaseConfig();
      if (missingSupabaseConfig.length > 0) {
        sendJson(response, 500, {
          message: `Servidor incompleto. Configure: ${missingSupabaseConfig.join(", ")} no arquivo .env.`
        });
        return;
      }

      if (!isAuthenticated(request)) {
        sendJson(response, 401, { message: "Sessao administrativa invalida." });
        return;
      }

      const body = await readJsonBody(request);
      const nome = String(body.nome || "").trim();
      const cpf = String(body.cpf || "").replace(/\D/g, "");
      const pontuacao = Number(body.pontuacao);

      if (!nome) {
        sendJson(response, 400, { message: "Informe o nome do aluno." });
        return;
      }

      if (cpf.length !== 11) {
        sendJson(response, 400, { message: "Informe um CPF com 11 numeros." });
        return;
      }

      if (!Number.isFinite(pontuacao) || pontuacao < 0) {
        sendJson(response, 400, { message: "Informe uma pontuacao valida." });
        return;
      }

      const resultado = await salvarOuAtualizarAluno({ nome, cpf, pontuacao });
      sendJson(response, 200, { ok: true, ...resultado });
      return;
    }

    serveStaticFile(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      message: error.message || "Erro interno do servidor."
    });
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  const missingConfig = validateServerConfig();
  console.log(`Servidor iniciado em http://localhost:${PORT}`);

  if (missingConfig.length > 0) {
    console.log(`Pendencias no .env: ${missingConfig.join(", ")}`);
  }
});
