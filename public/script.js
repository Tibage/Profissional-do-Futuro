// =====================
// DADOS DOS COLÉGIOS
// =====================
const dados = {
  Bage: {
    colegios: {
      col1: { nome: "Silveira Martins", cidade: "Bagé", atividades: [] },
      col2: { nome: "Waldemar Amoretty", cidade: "Bagé", atividades: [] },
      col3: { nome: "Carlos Kluwe", cidade: "Bagé", atividades: [] },
      col4: { nome: "CFES", cidade: "Bagé", atividades: [] },
      col5: { nome: "CAIC", cidade: "Bagé", atividades: [] },
      col6: { nome: "Frei Plácido", cidade: "Bagé", atividades: [] },
      col7: { nome: "Justino Quintana", cidade: "Bagé", atividades: [] },
      col8: { nome: "José Gomes Filho", cidade: "Bagé", atividades: [] },
      col9: { nome: "Farroupilha", cidade: "Bagé", atividades: [] },
      col10: { nome: "Luiz Mércio Teixeira", cidade: "Bagé", atividades: [] },
      col11: { nome: "Luiz Maria Ferraz", cidade: "Bagé", atividades: [] },
      col12: { nome: "Auxiliadora", cidade: "Bagé", atividades: [] },
      col13: { nome: "Bradesco", cidade: "Bagé", atividades: [] }
    }
  },
  hulhanegra: {
    colegios: {
      col1: { nome: "Manuel Lucas", cidade: "Hulha Negra", atividades: [] },
      col2: { nome: "Quinze de Junho", cidade: "Hulha Negra", atividades: [] }
    }
  },
  candiota: {
    colegios: {
      col1: { nome: "08 de Agosto", cidade: "Candiota", atividades: [] },
      col2: { nome: "Jerônimo Mércio", cidade: "Candiota", atividades: [] },
      col3: { nome: "Francisco Assis", cidade: "Candiota", atividades: [] }
    }
  },
  dompedrito: {
    colegios: {
      col1: { nome: "CIEP", cidade: "Dom Pedrito", atividades: [] },
      col2: { nome: "Nossa Senhora do Patrocínio", cidade: "Dom Pedrito", atividades: [] },
      col3: { nome: "Cândida Corina", cidade: "Dom Pedrito", atividades: [] },
      col4: { nome: "E.E.E.P. Dom Pedrito", cidade: "Dom Pedrito", atividades: [] },
      col5: { nome: "Senhora do Horto", cidade: "Dom Pedrito", atividades: [] },
      col6: { nome: "Risoleta de Quadros", cidade: "Dom Pedrito", atividades: [] },
      col7: { nome: "Getúlio Dornelles Vargas", cidade: "Dom Pedrito", atividades: [] }
    }
  },
  acegua: {
    colegios: {
      col1: { nome: "Barão do Aceguá", cidade: "Aceguá", atividades: [] }
    }
  },
  pinheiro: {
    colegios: {
      col1: { nome: "Hipólito Ribeiro", cidade: "Pinheiro Machado", atividades: [] }
    }
  }
};

const eventosGerais = [
  {
    hora: "8 de outubro",
    nome: "Workshop das profissões",
    local: "Faculdade IDEAU"
  },
  {
    hora: "12 de novembro",
    nome: "Vestibular de Verão",
    local: "Faculdade IDEAU"
  }
];

Object.values(dados).forEach((cidade) => {
  Object.values(cidade.colegios).forEach((colegio) => {
    colegio.atividades = eventosGerais.map((evento) => ({ ...evento }));
  });
});

function preencherEscolasAdmin() {
  const select = document.getElementById("escolaAluno");
  if (!select) return;

  Object.values(dados)
    .flatMap((cidade) => Object.values(cidade.colegios).map((colegio) => colegio.nome))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .forEach((escola) => {
      const option = document.createElement("option");
      option.value = escola;
      option.textContent = escola;
      select.appendChild(option);
    });
}

// =====================
// UTIL
// =====================
function formatarCPF(input) {
  const numeros = input.value.replace(/\D/g, "").slice(0, 11);
  let cpf = numeros;

  cpf = cpf.replace(/(\d{3})(\d)/, "$1.$2");
  cpf = cpf.replace(/(\d{3})(\d)/, "$1.$2");
  cpf = cpf.replace(/(\d{3})(\d{1,2})$/, "$1-$2");

  input.value = cpf;
}

function mascararCpfSaida(cpf) {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  let body;

  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    const text = await response.text();
    const pareceHtml = text.trim().startsWith("<!DOCTYPE html") || text.trim().startsWith("<html");
    const usandoLiveServer = ["5500", "5501"].includes(window.location.port);

    if (usandoLiveServer) {
      throw new Error("Você abriu pelo Live Server. Inicie com 'npm start' e acesse http://localhost:3000 para usar o login.");
    }

    if (pareceHtml) {
      throw new Error("Abra o projeto pelo servidor local. Inicie com 'node server.js' ou 'npm start' e acesse http://localhost:3000.");
    }

    throw new Error("Resposta inesperada do servidor.");
  }

  if (!response.ok) {
    throw new Error(body.message || "Não foi possível concluir a requisição.");
  }

  return body;
}

function mostrarErro(container, mensagem) {
  container.innerHTML = `
    <div class="status-box error">
      ${mensagem}
    </div>`;
}

function escaparHtml(valor) {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function limparRankingEscola() {
  document.getElementById("rankingEscola").innerHTML = "";
}

async function carregarRankingEscola(escola) {
  const ranking = document.getElementById("rankingEscola");
  ranking.innerHTML = `<div class="ranking-carregando">Carregando ranking da escola...</div>`;

  try {
    const resposta = await requestJson(`/api/ranking?escola=${encodeURIComponent(escola)}&limit=10`);
    const cidade = document.getElementById("cidade").value;
    const colegioKey = document.getElementById("colegio").value;
    const escolaAtual = cidade && colegioKey ? dados[cidade].colegios[colegioKey].nome : "";
    if (escolaAtual !== escola) return;

    if (resposta.ranking.length === 0) {
      ranking.innerHTML = `<section class="ranking-box"><h2>Ranking — ${escaparHtml(escola)}</h2><p>Ainda não há alunos vinculados a esta escola.</p></section>`;
      return;
    }

    ranking.innerHTML = `<section class="ranking-box"><h2>Ranking — ${escaparHtml(escola)}</h2><ol>${resposta.ranking.map((aluno) => `
      <li><span class="ranking-posicao">${aluno.posicao}º</span><span class="ranking-nome">${escaparHtml(aluno.nome)}</span><strong>${aluno.pontuacao} pts</strong></li>`).join("")}</ol></section>`;
  } catch (error) {
    ranking.innerHTML = `<div class="status-box error">Não foi possível carregar o ranking: ${escaparHtml(error.message)}</div>`;
  }
}

// =====================
// COLÉGIOS
// =====================
function atualizarColegios() {
  const cidade = document.getElementById("cidade").value;
  const selectColegio = document.getElementById("colegio");

  selectColegio.innerHTML = '<option value="">Selecione...</option>';
  limparRankingEscola();
  document.getElementById("resultado").innerHTML = `
    <div class="placeholder">
      <div class="placeholder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2d7a52" stroke-width="1.5" stroke-linecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <p>Agora selecione o colégio.</p>
    </div>`;

  if (!cidade) {
    selectColegio.disabled = true;
    return;
  }

  const colegios = dados[cidade].colegios;
  Object.entries(colegios).forEach(([key, colegio]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = colegio.nome;
    selectColegio.appendChild(option);
  });

  selectColegio.disabled = false;
}

function mostrarHorarios() {
  const cidade = document.getElementById("cidade").value;
  const colegioKey = document.getElementById("colegio").value;
  const resultado = document.getElementById("resultado");

  if (!colegioKey) return;

  const colegio = dados[cidade].colegios[colegioKey];
  const totalAtividades = colegio.atividades.length;

  let html = `
    <div class="escola-header">
      <div class="escola-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2d7a52" stroke-width="1.5" stroke-linecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div>
        <div class="escola-nome">${colegio.nome}</div>
        <div class="escola-sub">${colegio.cidade}</div>
      </div>
      ${totalAtividades > 0 ? `<div class="total-badge">${totalAtividades} atividade${totalAtividades !== 1 ? "s" : ""}</div>` : ""}
    </div>`;

  if (totalAtividades === 0) {
    html += `
      <div class="placeholder">
        <div class="placeholder-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#2d7a52" stroke-width="1.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <p>Horários em breve.</p>
      </div>`;
  } else {
    colegio.atividades.forEach((atividade) => {
      html += `
        <div class="atividade">
          <div class="hora-pill">${atividade.hora}</div>
          <div class="ativ-info">
            <div class="ativ-nome">${atividade.nome}</div>
            <div class="ativ-local">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5a8a6a" stroke-width="2" stroke-linecap="round">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              ${atividade.local}
            </div>
          </div>
        </div>`;
    });
  }

  resultado.innerHTML = html;
  carregarRankingEscola(colegio.nome);
}

// =====================
// CONSULTA PÚBLICA
// =====================
async function consultarPontuacao() {
  const input = document.getElementById("cpf");
  const resultado = document.getElementById("resultadoPontuacao");
  const cpf = input.value.replace(/\D/g, "");

  if (cpf.length !== 11) {
    mostrarErro(resultado, "Informe um CPF com 11 números para consultar a pontuação.");
    return;
  }

  resultado.innerHTML = `<div class="status-box info">Consultando...</div>`;

  try {
    const dadosAluno = await requestJson(`/api/pontuacao?cpf=${cpf}`);

    resultado.innerHTML = `
      <div class="pontuacao-box">
        <div class="pontuacao-topo">
          <div>
            <div class="pontuacao-label">Consulta realizada para</div>
            <div class="pontuacao-cpf">${mascararCpfSaida(cpf)}</div>
          </div>
          <div class="pontuacao-valor">
            <div class="pontuacao-numero">${dadosAluno.pontuacao}</div>
            <div class="pontuacao-texto">pontos</div>
          </div>
        </div>
        <div class="status-box success">
          <strong>${dadosAluno.nome}</strong><br>
          Pontuação localizada com sucesso.
        </div>
      </div>`;
  } catch (error) {
    mostrarErro(resultado, error.message);
  }
}

// =====================
// ÁREA ADMIN
// =====================
function atualizarAreaAdmin(autorizado) {
  const loginArea = document.getElementById("adminLoginArea");
  const cadastroArea = document.getElementById("adminCadastroArea");
  const botaoSair = document.getElementById("adminSair");

  loginArea.classList.toggle("hidden", autorizado);
  cadastroArea.classList.toggle("hidden", !autorizado);
  botaoSair.classList.toggle("hidden", !autorizado);
}

async function carregarSessaoAdmin() {
  try {
    const sessao = await requestJson("/api/admin/session");
    atualizarAreaAdmin(Boolean(sessao.authenticated));
  } catch (error) {
    atualizarAreaAdmin(false);
  }
}

async function entrarAdmin(event) {
  event.preventDefault();

  const usuarioInput = document.getElementById("adminUsuario");
  const senhaInput = document.getElementById("adminSenha");

  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usuarioInput.value.trim(),
        password: senhaInput.value
      })
    });

    senhaInput.value = "";
    atualizarAreaAdmin(true);
  } catch (error) {
    alert(error.message);
    senhaInput.value = "";
  }
}

async function sairAdmin() {
  try {
    await requestJson("/api/admin/logout", { method: "POST" });
  } finally {
    atualizarAreaAdmin(false);
  }
}

async function salvarAluno(event) {
  event.preventDefault();

  const nomeInput = document.getElementById("nomeAluno");
  const cpfInput = document.getElementById("cpfCadastro");
  const escolaInput = document.getElementById("escolaAluno");
  const pontuacaoInput = document.getElementById("pontuacaoAluno");
  const resultado = document.getElementById("resultadoCadastro");

  const nome = nomeInput.value.trim();
  const cpf = cpfInput.value.replace(/\D/g, "");
  const escola = escolaInput.value;
  const pontuacao = Number(pontuacaoInput.value);

  if (!nome) {
    mostrarErro(resultado, "Informe o nome do aluno.");
    return;
  }

  if (cpf.length !== 11) {
    mostrarErro(resultado, "Informe um CPF com 11 números.");
    return;
  }

  if (!escola) {
    mostrarErro(resultado, "Selecione a escola do aluno.");
    return;
  }

  if (!Number.isFinite(pontuacao) || pontuacao < 0) {
    mostrarErro(resultado, "Informe uma pontuação válida.");
    return;
  }

  resultado.innerHTML = `<div class="status-box info">Salvando aluno...</div>`;

  try {
    const resposta = await requestJson("/api/admin/alunos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, cpf, escola, pontuacao })
    });

    resultado.innerHTML = `
      <div class="status-box success">
        <strong>${nome}</strong><br>
        Aluno ${resposta.action} com sucesso. Escola: ${escaparHtml(escola)}. CPF: ${mascararCpfSaida(cpf)}. Foram adicionados ${resposta.adicionado} pontos. Total atual: ${resposta.total} pontos.
      </div>`;

    nomeInput.value = "";
    cpfInput.value = "";
    escolaInput.value = "";
    pontuacaoInput.value = "";
  } catch (error) {
    mostrarErro(resultado, error.message);
  }
}

window.atualizarColegios = atualizarColegios;
window.mostrarHorarios = mostrarHorarios;
window.formatarCPF = formatarCPF;
window.consultarPontuacao = consultarPontuacao;
window.entrarAdmin = entrarAdmin;
window.sairAdmin = sairAdmin;
window.salvarAluno = salvarAluno;

preencherEscolasAdmin();

carregarSessaoAdmin();
