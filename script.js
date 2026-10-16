(() => {
  'use strict';

  /* =====================================================
     Utilidades
  ===================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MAX_ERRORS = 6;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = (i) => `hsl(${(i * 47 + 180) % 360} 85% 62%)`;
  const initial = (n) => esc(([...n][0] || '?').toUpperCase());

  /* =====================================================
     Palavras por categoria
  ===================================================== */
  const WORDS = {
    'Animais': ['ELEFANTE', 'GIRAFA', 'GOLFINHO', 'PAPAGAIO', 'BORBOLETA', 'TARTARUGA', 'CROCODILO', 'PINGUIM', 'ESQUILO', 'JACARÉ', 'TUBARÃO', 'CANGURU', 'ORANGOTANGO', 'HIPOPÓTAMO'],
    'Frutas': ['ABACAXI', 'MORANGO', 'MELANCIA', 'BANANA', 'LARANJA', 'MARACUJÁ', 'GOIABA', 'PÊSSEGO', 'ABACATE', 'JABUTICABA', 'CARAMBOLA', 'TANGERINA', 'ACEROLA', 'MAMÃO'],
    'Países': ['BRASIL', 'ARGENTINA', 'PORTUGAL', 'JAPÃO', 'CANADÁ', 'ALEMANHA', 'ESPANHA', 'MÉXICO', 'AUSTRÁLIA', 'NORUEGA', 'COLÔMBIA', 'URUGUAI', 'EGITO', 'TURQUIA'],
    'Profissões': ['PROFESSOR', 'MÉDICO', 'ENGENHEIRO', 'PROGRAMADOR', 'BOMBEIRO', 'ADVOGADO', 'PADEIRO', 'ELETRICISTA', 'JARDINEIRO', 'ASTRONAUTA', 'DENTISTA', 'ARQUITETO', 'COZINHEIRO', 'MOTORISTA'],
    'Objetos': ['CADEIRA', 'GELADEIRA', 'TELEFONE', 'TESOURA', 'ESPELHO', 'VENTILADOR', 'LANTERNA', 'RELÓGIO', 'MOCHILA', 'ESCOVA', 'TRAVESSEIRO', 'CHAVEIRO', 'LIQUIDIFICADOR', 'MARTELO'],
    'Tecnologia': ['COMPUTADOR', 'TECLADO', 'INTERNET', 'SERVIDOR', 'ALGORITMO', 'NAVEGADOR', 'JAVASCRIPT', 'PROGRAMA', 'SOFTWARE', 'PROCESSADOR', 'ROTEADOR', 'VARIÁVEL', 'COMPILADOR', 'BLUETOOTH'],
    'Esportes': ['FUTEBOL', 'BASQUETE', 'NATAÇÃO', 'VOLEIBOL', 'ATLETISMO', 'GINÁSTICA', 'CICLISMO', 'SURFE', 'BOXE', 'HANDEBOL', 'ESGRIMA', 'TÊNIS', 'CAPOEIRA', 'SKATE'],
    'Comidas': ['FEIJOADA', 'LASANHA', 'BRIGADEIRO', 'COXINHA', 'PIZZA', 'HAMBÚRGUER', 'PANQUECA', 'MACARRÃO', 'TAPIOCA', 'PASTEL', 'SORVETE', 'CHURRASCO', 'PAMONHA', 'ESTROGONOFE'],
  };

  /* =====================================================
     Estado global
  ===================================================== */
  let mode = null;          // 'local' | 'online'
  let role = null;          // 'host' | 'client' (somente online)
  let peer = null;          // instância do PeerJS
  let conns = new Map();    // anfitrião: peerId -> conexão
  let hostConn = null;      // cliente: conexão com o anfitrião
  let myId = null;
  let game = null;          // estado completo (somente local/anfitrião)
  let view = null;          // estado público usado para desenhar a tela
  let recvAt = 0;
  let turnTimer = null;
  let roundTimer = null;
  let leaving = false;
  let localNames = ['Jogador 1', 'Jogador 2'];
  let gallowsSvg = null;
  let hostPing = null;      // anfitrião: intervalo de ping
  let watchdog = null;      // cliente: vigia da conexão
  let lastHostMsg = 0;      // cliente: última mensagem recebida do anfitrião
  const lastSeen = new Map(); // anfitrião: última mensagem de cada jogador
  let wakeLock = null;

  /* =====================================================
     Desenho da forca (SVG)
  ===================================================== */
  function gallowsMarkup(ghostOnly = false) {
    const parts = [
      '<circle cx="110" cy="62" r="17"/>',
      '<line x1="110" y1="79" x2="110" y2="135"/>',
      '<line x1="110" y1="92" x2="86" y2="118"/>',
      '<line x1="110" y1="92" x2="134" y2="118"/>',
      '<line x1="110" y1="135" x2="90" y2="170"/>',
      '<line x1="110" y1="135" x2="130" y2="170"/>',
    ];
    const frame = '<g class="frame"><line x1="12" y1="212" x2="132" y2="212"/><line x1="42" y1="212" x2="42" y2="18"/><line x1="39" y1="20" x2="112" y2="20"/><line x1="110" y1="20" x2="110" y2="45"/></g>';
    const ghost = `<g class="ghost">${parts.join('')}</g>`;
    const solid = ghostOnly ? '' : `<g class="solid">${parts.map((p, i) => p.replace('/>', ` class="part" data-i="${i}"/>`)).join('')}</g>`;
    const dead = ghostOnly ? '' : '<g class="dead"><path d="M102 56l6 6m0-6l-6 6M112 56l6 6m0-6l-6 6"/></g>';
    return `<svg viewBox="0 0 170 225" xmlns="http://www.w3.org/2000/svg">${frame}${ghost}${solid}${dead}</svg>`;
  }

  /* =====================================================
     Navegação entre telas
  ===================================================== */
  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function hideOverlays() {
    $$('.overlay').forEach((o) => o.classList.remove('show'));
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignora */ }
      ta.remove();
    }
    toast('Copiado!');
  }

  /* =====================================================
     Motor do jogo (roda no anfitrião ou no modo local)
  ===================================================== */
  function newGame(code) {
    return {
      code,
      phase: 'lobby',                    // lobby | playing | roundEnd | final
      settings: { maxPlayers: 16, rounds: 3, turnTime: 30, category: 'Todas' },
      players: [],
      round: 0,
      word: '',
      category: '',
      guessed: [],
      wrong: [],
      errors: 0,
      turn: 0,
      turnDeadline: 0,
      nextAt: 0,
      event: '',
      result: null,
      used: new Set(),
    };
  }

  function pickWord() {
    const cats = game.settings.category === 'Todas' ? Object.keys(WORDS) : [game.settings.category];
    const pool = [];
    cats.forEach((c) => (WORDS[c] || []).forEach((w) => pool.push({ w: w.normalize('NFC'), c })));
    let fresh = pool.filter((x) => !game.used.has(x.w));
    if (!fresh.length) { game.used.clear(); fresh = pool; }
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    game.used.add(pick.w);
    return pick;
  }

  function maskedWord() {
    return [...game.word].map((ch) => (game.guessed.includes(norm(ch)) ? ch : '_')).join('');
  }
  const isSolved = () => !maskedWord().includes('_');

  function nextTurn(from) {
    const n = game.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      if (game.players[idx].connected) { game.turn = idx; return; }
    }
  }

  function clearTurnTimer() { clearTimeout(turnTimer); turnTimer = null; game && (game.turnDeadline = 0); }
  function startTurnTimer() {
    clearTimeout(turnTimer);
    const secs = game.settings.turnTime;
    if (!secs) { game.turnDeadline = 0; return; }
    game.turnDeadline = Date.now() + secs * 1000;
    turnTimer = setTimeout(onTurnTimeout, secs * 1000);
  }
  function onTurnTimeout() {
    if (!game || game.phase !== 'playing') return;
    const p = game.players[game.turn];
    game.event = `${p.name} demorou demais e perdeu a vez.`;
    nextTurn(game.turn);
    startTurnTimer();
    broadcast();
  }

  function startGame() {
    game.players.forEach((p) => (p.score = 0));
    game.round = 0;
    game.used = new Set();
    startRound();
  }

  function startRound() {
    game.round++;
    const pick = pickWord();
    game.word = pick.w;
    game.category = pick.c;
    game.guessed = [];
    game.wrong = [];
    game.errors = 0;
    game.result = null;
    game.nextAt = 0;
    const n = game.players.length;
    const base = (game.round - 1) % n;
    game.turn = base;
    if (!game.players[base].connected) nextTurn(base);
    game.phase = 'playing';
    game.event = `Rodada ${game.round}: ${game.players[game.turn].name} começa!`;
    startTurnTimer();
    broadcast();
  }

  function finishRound(win, p, msg) {
    clearTurnTimer();
    game.phase = 'roundEnd';
    game.result = { win, playerId: p.id, playerName: p.name };
    game.event = msg;
    clearTimeout(roundTimer);
    if (mode === 'online') {
      game.nextAt = Date.now() + 10000;
      roundTimer = setTimeout(advanceRound, 10000);
    }
    broadcast();
  }

  function advanceRound() {
    clearTimeout(roundTimer);
    if (!game || game.phase !== 'roundEnd') return;
    game.nextAt = 0;
    if (game.round >= game.settings.rounds) {
      game.phase = 'final';
      broadcast();
    } else {
      startRound();
    }
  }

  function currentPlayerFor(playerId) {
    if (!game || game.phase !== 'playing') return null;
    const p = game.players[game.turn];
    return p && p.id === playerId ? p : null;
  }

  function guess(playerId, letter) {
    const p = currentPlayerFor(playerId);
    if (!p) return;
    letter = norm(String(letter || ''));
    if (!/^[A-Z]$/.test(letter) || game.guessed.includes(letter)) return;

    clearTimeout(turnTimer);
    game.guessed.push(letter);
    const count = [...game.word].filter((ch) => norm(ch) === letter).length;

    if (count > 0) {
      const pts = 10 * count;
      p.score += pts;
      if (isSolved()) {
        p.score += 20;
        finishRound(true, p, `${p.name} completou a palavra! (+${pts + 20})`);
        return;
      }
      game.event = `${p.name} acertou a letra ${letter} (+${pts}).`;
    } else {
      game.wrong.push(letter);
      game.errors++;
      if (game.errors >= MAX_ERRORS) {
        p.score = Math.max(0, p.score - 10);
        finishRound(false, p, `${p.name} deu o último erro (-10).`);
        return;
      }
      game.event = `${p.name} errou a letra ${letter}.`;
    }
    nextTurn(game.turn);
    startTurnTimer();
    broadcast();
  }

  function guessWord(playerId, text) {
    const p = currentPlayerFor(playerId);
    if (!p) return;
    const t = norm(String(text || '').trim());
    if (!t) return;
    clearTimeout(turnTimer);

    if (t === norm(game.word)) {
      const hidden = [...game.word].filter((ch) => !game.guessed.includes(norm(ch))).length;
      const pts = hidden * 10 + 30;
      p.score += pts;
      [...game.word].forEach((ch) => { const l = norm(ch); if (!game.guessed.includes(l)) game.guessed.push(l); });
      finishRound(true, p, `${p.name} acertou a palavra inteira! (+${pts})`);
      return;
    }
    game.errors++;
    if (game.errors >= MAX_ERRORS) {
      p.score = Math.max(0, p.score - 10);
      finishRound(false, p, `${p.name} errou o chute final (-10).`);
      return;
    }
    game.event = `${p.name} chutou a palavra e errou.`;
    nextTurn(game.turn);
    startTurnTimer();
    broadcast();
  }

  function publicState() {
    const g = game;
    const reveal = g.phase === 'roundEnd' || g.phase === 'final';
    return {
      phase: g.phase,
      code: g.code,
      settings: g.settings,
      players: g.players.map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
      round: g.round,
      totalRounds: g.settings.rounds,
      category: g.category,
      masked: g.word ? maskedWord() : '',
      guessed: g.guessed,
      wrong: g.wrong,
      errors: g.errors,
      turn: g.turn,
      turnLeft: g.turnDeadline ? Math.max(0, g.turnDeadline - Date.now()) : 0,
      turnTotal: g.settings.turnTime * 1000,
      event: g.event,
      result: g.result,
      word: reveal ? g.word : null,
      nextIn: g.nextAt ? Math.max(0, g.nextAt - Date.now()) : 0,
    };
  }

  function broadcast() {
    if (!game) return;
    const s = publicState();
    view = s;
    recvAt = Date.now();
    render(s);
    if (mode === 'online' && role === 'host') {
      conns.forEach((c) => { if (c.open) { try { c.send({ t: 'state', s }); } catch (e) { /* ignora */ } } });
    }
  }

  function removePlayer(id) {
    if (!game) return;
    const idx = game.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const p = game.players[idx];
    if (game.phase === 'lobby') {
      game.players.splice(idx, 1);
    } else {
      p.connected = false;
      game.event = `${p.name} saiu da partida.`;
      if (game.phase === 'playing' && game.turn === idx) {
        clearTimeout(turnTimer);
        nextTurn(idx);
        startTurnTimer();
      }
    }
    broadcast();
  }

  /* =====================================================
     Ações do jogador (local, anfitrião ou cliente)
  ===================================================== */
  const isController = () => mode === 'local' || role === 'host';

  function meIsTurn(s) {
    if (!s || s.phase !== 'playing') return false;
    if (mode === 'local') return true;
    const cur = s.players[s.turn];
    return !!cur && cur.id === myId;
  }

  function act(type, value) {
    if (isController()) {
      if (!game) return;
      const pid = mode === 'local' ? game.players[game.turn].id : myId;
      if (type === 'guess') guess(pid, value);
      else if (type === 'word') guessWord(pid, value);
    } else if (hostConn && hostConn.open) {
      hostConn.send(type === 'guess' ? { t: 'guess', letter: value } : { t: 'word', word: value });
    }
  }

  function requestGuess(letter) {
    if (!meIsTurn(view) || view.guessed.includes(letter)) return;
    act('guess', letter);
  }

  /* =====================================================
     Renderização
  ===================================================== */
  function render(s) {
    if (s.phase === 'lobby') {
      renderLobby(s);
      hideOverlays();
      show('screen-lobby');
    } else {
      renderGame(s);
      show('screen-game');
    }
  }

  function renderLobby(s) {
    $('#lb-code').textContent = s.code;
    $('#lb-players').innerHTML = s.players.map((p, i) => `
      <li class="player">
        <span class="avatar" style="--c:${color(i)}">${initial(p.name)}</span>
        <span class="pname">${esc(p.name)}</span>
        ${i === 0 ? '<span class="tag">anfitrião</span>' : ''}
        ${p.id === myId ? '<span class="tag you">você</span>' : ''}
      </li>`).join('');
    $('#lb-count').textContent = `${s.players.length} de ${s.settings.maxPlayers} jogadores`;

    $('#lb-max').value = String(s.settings.maxPlayers);
    $('#lb-rounds').value = String(s.settings.rounds);
    $('#lb-time').value = String(s.settings.turnTime);
    $('#lb-cat').value = s.settings.category;
    const host = role === 'host';
    ['#lb-max', '#lb-rounds', '#lb-time', '#lb-cat'].forEach((sel) => ($(sel).disabled = !host));

    const btn = $('#btn-start');
    btn.hidden = !host;
    btn.disabled = s.players.length < 2;
    $('#lb-hint').textContent = host
      ? (s.players.length < 2 ? 'Compartilhe o código para chamar mais jogadores. São necessários pelo menos 2.' : 'Tudo pronto. Inicie quando quiser.')
      : 'Aguardando o anfitrião iniciar o jogo...';
  }

  function rankHTML(s) {
    const sorted = [...s.players].sort((a, b) => b.score - a.score);
    let pos = 0;
    let last = null;
    return sorted.map((p, i) => {
      if (p.score !== last) { pos = i + 1; last = p.score; }
      const medal = ['🥇', '🥈', '🥉'][pos - 1] || `${pos}º`;
      return `<li><span class="pos">${medal}</span><span class="rname">${esc(p.name)}</span><span class="rscore">${p.score} pts</span></li>`;
    }).join('');
  }

  function renderPlayers(s) {
    $('#g-players').innerHTML = s.players.map((p, i) => {
      const turn = s.phase === 'playing' && i === s.turn;
      const cls = ['player', turn ? 'turn' : '', !p.connected ? 'off' : ''].join(' ');
      return `<li class="${cls}">
        <span class="avatar" style="--c:${color(i)}">${initial(p.name)}</span>
        <span class="pname">${esc(p.name)}</span>
        ${mode === 'online' && p.id === myId ? '<span class="tag you">você</span>' : ''}
        <span class="pscore">${p.score}</span>
      </li>`;
    }).join('');
  }

  let lastMasked = '';
  function renderGame(s) {
    $('#g-round').textContent = `Rodada ${s.round} de ${s.totalRounds}`;
    $('#g-cat').textContent = `Dica: ${s.category}`;
    $('#g-net').hidden = mode !== 'online';

    // forca
    if (gallowsSvg) {
      $$('.part', gallowsSvg).forEach((p, i) => p.classList.toggle('on', i < s.errors));
      gallowsSvg.classList.toggle('lost', s.errors >= MAX_ERRORS);
    }

    // palavra
    const masked = [...s.masked];
    const full = s.word ? [...s.word] : null;
    const newLetters = lastMasked.length === s.masked.length;
    $('#g-word').innerHTML = masked.map((ch, i) => {
      const hidden = ch === '_';
      const shown = hidden ? (full ? full[i] : '') : ch;
      const fresh = newLetters && !hidden && lastMasked[i] === '_';
      return `<span class="slot${hidden && full ? ' miss' : ''}${fresh ? ' pop' : ''}">${esc(shown)}</span>`;
    }).join('');
    $('#g-word').setAttribute('aria-label', `Palavra com ${masked.length} letras`);
    lastMasked = s.masked;

    // jogadores e vez
    renderPlayers(s);
    const my = meIsTurn(s);
    const cur = s.players[s.turn];
    let turnHTML = 'Rodada encerrada';
    if (s.phase === 'playing' && cur) {
      turnHTML = (mode === 'online' && cur.id === myId)
        ? '<b>Sua vez!</b> Escolha uma letra'
        : `Vez de <b>${esc(cur.name)}</b>`;
    }
    $('#g-turn').innerHTML = turnHTML;
    $('#g-event').textContent = s.event || '';

    // teclado
    const keys = $('#g-keys');
    $$('.key', keys).forEach((b) => {
      const l = b.dataset.l;
      const used = s.guessed.includes(l);
      const wrong = s.wrong.includes(l);
      b.classList.toggle('hit', used && !wrong);
      b.classList.toggle('miss', wrong);
      b.disabled = used || !my;
    });
    keys.classList.toggle('locked', !my);
    $('#btn-guess-word').disabled = !my;
    $('#g-errs').textContent = s.errors;
    $('#g-wrong').textContent = s.wrong.join(' ');

    // fim de rodada
    const ovr = $('#ov-round');
    ovr.classList.toggle('show', s.phase === 'roundEnd');
    if (s.phase === 'roundEnd' && s.result) {
      $('#or-title').textContent = s.result.win ? 'Palavra descoberta!' : 'Enforcado!';
      $('#or-word').textContent = s.word || '';
      $('#or-msg').textContent = s.event || '';
      $('#or-rank').innerHTML = rankHTML(s);
      const ctl = isController();
      const last = s.round >= s.totalRounds;
      $('#btn-next').hidden = !ctl;
      $('#btn-next').textContent = last ? 'Ver resultado final' : 'Próxima rodada';
      $('#or-wait').hidden = ctl || mode === 'local';
      $('#or-count').hidden = mode === 'local';
    }

    // resultado final
    const ovf = $('#ov-final');
    ovf.classList.toggle('show', s.phase === 'final');
    if (s.phase === 'final') {
      $('#of-rank').innerHTML = rankHTML(s);
      const ctl = isController();
      $('#btn-again').hidden = !ctl;
      $('#of-wait').hidden = ctl;
      $('#btn-final-exit').textContent = mode === 'local' ? 'Voltar ao menu' : 'Sair da sala';
    }

    if (s.phase !== 'playing') $('#ov-word').classList.remove('show');
  }

  // contagens regressivas (tempo da jogada e próxima rodada)
  setInterval(() => {
    if (!view) return;
    const elapsed = Date.now() - recvAt;
    const bar = $('#g-timer-bar');
    const time = $('#g-time');
    if (mode === 'online') {
      const stale = role === 'client' && Date.now() - lastHostMsg > 12000;
      $('#g-net').classList.toggle('warn', stale);
      $('#g-net-text').textContent = stale ? 'Reconectando...' : `Sala ${view.code}`;
    }
    if (view.phase === 'playing' && view.turnTotal > 0) {
      const left = Math.max(0, view.turnLeft - elapsed);
      const pct = (left / view.turnTotal) * 100;
      bar.style.width = pct + '%';
      bar.classList.toggle('low', pct < 25);
      time.textContent = Math.ceil(left / 1000) + 's';
    } else {
      bar.style.width = view.phase === 'playing' ? '100%' : '0';
      bar.classList.remove('low');
      time.textContent = '';
    }
    if (view.phase === 'roundEnd' && view.nextIn > 0) {
      const left = Math.max(0, view.nextIn - elapsed);
      $('#or-count').textContent = `Próxima etapa em ${Math.ceil(left / 1000)}s`;
    }
  }, 200);

  /* =====================================================
     Modo online (PeerJS / WebRTC, sem servidor próprio)
  ===================================================== */
  function setOnlineMsg(t) { $('#online-msg').textContent = t || ''; }
  function sanitizeName(n, fallback = 'Jogador') { return (n || '').trim().slice(0, 14) || fallback; }
  function uniqueName(name, taken) {
    let n = name;
    let i = 2;
    while (taken.some((t) => t.toLowerCase() === n.toLowerCase())) n = `${name} (${i++})`;
    return n;
  }
  function saveName(n) { try { localStorage.setItem('forca_nome', n); } catch (e) { /* ignora */ } }
  function loadName() { try { return localStorage.getItem('forca_nome') || ''; } catch (e) { return ''; } }
  function genCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function ensurePeerLib() {
    if (typeof Peer === 'undefined') {
      setOnlineMsg('Não foi possível carregar o módulo online. Verifique sua internet e recarregue a página.');
      return false;
    }
    return true;
  }

  // Servidores STUN + retransmissão TURN pública (usada quando a rede bloqueia a conexão direta,
  // comum entre 4G/5G e Wi-Fi). Para uso em produção, troque pelo seu próprio TURN.
  function peerOptions() {
    return {
      debug: 0,
      config: {
        iceCandidatePoolSize: 4,
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
          { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
        ],
      },
    };
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* ignora */ }
  }

  function startHostKeepalive() {
    clearInterval(hostPing);
    hostPing = setInterval(() => {
      const now = Date.now();
      conns.forEach((c, id) => {
        if (now - (lastSeen.get(id) || now) > 30000) {
          try { c.close(); } catch (e) { /* ignora */ }
          onHostConnClose(c);
          return;
        }
        if (c.open) { try { c.send({ t: 'ping' }); } catch (e) { /* ignora */ } }
      });
    }, 5000);
  }

  function startWatchdog() {
    clearInterval(watchdog);
    lastHostMsg = Date.now();
    watchdog = setInterval(() => {
      if (mode === 'online' && role === 'client' && Date.now() - lastHostMsg > 30000) onRoomClosed();
    }, 5000);
  }

  function createRoom(attempt = 0) {
    if (!ensurePeerLib()) return;
    leaving = false;
    const name = sanitizeName($('#in-name').value);
    saveName(name);
    setOnlineMsg('Criando sala...');
    const code = genCode();
    const p = new Peer('forca-' + code, peerOptions());
    let opened = false;

    p.on('open', (id) => {
      opened = true;
      peer = p; mode = 'online'; role = 'host'; myId = id;
      game = newGame(code);
      game.players.push({ id, name, score: 0, connected: true });
      setOnlineMsg('');
      startHostKeepalive();
      keepAwake();
      broadcast();
    });
    p.on('connection', (conn) => {
      conn.on('data', (d) => onHostMessage(conn, d));
      conn.on('close', () => onHostConnClose(conn));
      conn.on('error', () => onHostConnClose(conn));
    });
    p.on('disconnected', () => { if (!p.destroyed) { try { p.reconnect(); } catch (e) { /* ignora */ } } });
    p.on('error', (err) => {
      if (opened) return;
      try { p.destroy(); } catch (e) { /* ignora */ }
      if (err.type === 'unavailable-id' && attempt < 4) createRoom(attempt + 1);
      else setOnlineMsg(`Não foi possível criar a sala (${err.type}).`);
    });
  }

  function onHostMessage(conn, d) {
    if (!game || !d) return;
    const id = conn.peer;
    lastSeen.set(id, Date.now());
    if (d.t === 'pong') return;
    if (d.t === 'sync') {
      try { if (conn.open) conn.send({ t: 'state', s: publicState() }); } catch (e) { /* ignora */ }
      return;
    }
    if (d.t === 'join') {
      if (game.phase !== 'lobby') return rejectConn(conn, 'A partida já começou.');
      if (game.players.length >= game.settings.maxPlayers) return rejectConn(conn, 'A sala está cheia.');
      if (game.players.some((p) => p.id === id)) return;
      const name = uniqueName(sanitizeName(d.name), game.players.map((p) => p.name));
      game.players.push({ id, name, score: 0, connected: true });
      conns.set(id, conn);
      broadcast();
    } else if (d.t === 'guess') {
      guess(id, d.letter);
    } else if (d.t === 'word') {
      guessWord(id, d.word);
    } else if (d.t === 'leave') {
      conns.delete(id);
      removePlayer(id);
    }
  }
  function rejectConn(conn, reason) {
    try { conn.send({ t: 'reject', reason }); } catch (e) { /* ignora */ }
    setTimeout(() => { try { conn.close(); } catch (e) { /* ignora */ } }, 400);
  }
  function onHostConnClose(conn) {
    if (conns.get(conn.peer) === conn) {
      conns.delete(conn.peer);
      removePlayer(conn.peer);
    }
  }

  function joinRoom() {
    if (!ensurePeerLib()) return;
    leaving = false;
    const name = sanitizeName($('#in-name').value);
    saveName(name);
    const code = ($('#in-code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { setOnlineMsg('Digite o código da sala.'); return; }
    setOnlineMsg('Entrando na sala...');

    const p = new Peer(peerOptions());
    let c = null;
    let joined = false;
    let failed = false;
    const fail = (msg) => {
      if (failed || joined) return;
      failed = true;
      clearTimeout(timeout);
      try { p.destroy(); } catch (e) { /* ignora */ }
      setOnlineMsg(msg);
    };
    const timeout = setTimeout(() => fail('Não foi possível conectar. Confira o código e a internet.'), 15000);

    p.on('open', (id) => {
      myId = id;
      c = p.connect('forca-' + code, { reliable: true });
      c.on('open', () => c.send({ t: 'join', name }));
      c.on('data', (d) => {
        if (!d) return;
        lastHostMsg = Date.now();
        if (d.t === 'ping') { try { c.send({ t: 'pong' }); } catch (e) { /* ignora */ } return; }
        if (d.t === 'reject') { fail(d.reason || 'Não foi possível entrar na sala.'); return; }
        if (d.t === 'closed') { if (joined) onRoomClosed(); return; }
        if (d.t === 'state') {
          if (!joined) {
            joined = true;
            clearTimeout(timeout);
            mode = 'online'; role = 'client'; peer = p; hostConn = c;
            setOnlineMsg('');
            startWatchdog();
            keepAwake();
          }
          view = d.s;
          recvAt = Date.now();
          render(view);
        }
      });
      c.on('close', () => { if (joined) onRoomClosed(); else fail('A sala não respondeu.'); });
    });
    p.on('error', (err) => {
      fail(err.type === 'peer-unavailable' ? 'Sala não encontrada. Confira o código.' : `Erro de conexão (${err.type}).`);
    });
  }

  function onRoomClosed() {
    if (leaving) return;
    cleanupNetwork();
    setOnlineMsg('A sala foi encerrada ou a conexão caiu.');
    show('screen-online');
  }

  function cleanupNetwork() {
    clearTimeout(turnTimer);
    clearTimeout(roundTimer);
    clearInterval(hostPing);
    clearInterval(watchdog);
    lastSeen.clear();
    if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignora */ } wakeLock = null; }
    const pr = peer;
    const cs = [...conns.values()];
    const hc = hostConn;
    peer = null; hostConn = null; conns = new Map();
    game = null; view = null; role = null; mode = null; myId = null; lastMasked = '';
    hideOverlays();
    setTimeout(() => {
      cs.forEach((c) => { try { c.close(); } catch (e) { /* ignora */ } });
      try { hc && hc.close(); } catch (e) { /* ignora */ }
      try { pr && pr.destroy(); } catch (e) { /* ignora */ }
    }, 300);
  }

  function leaveToMenu() {
    leaving = true;
    if (mode === 'online') {
      try {
        if (role === 'host') conns.forEach((c) => c.open && c.send({ t: 'closed' }));
        else if (hostConn && hostConn.open) hostConn.send({ t: 'leave' });
      } catch (e) { /* ignora */ }
    }
    cleanupNetwork();
    show('screen-menu');
  }

  window.addEventListener('beforeunload', () => {
    try {
      if (mode === 'online') {
        if (role === 'host') conns.forEach((c) => c.open && c.send({ t: 'closed' }));
        else if (hostConn && hostConn.open) hostConn.send({ t: 'leave' });
      }
    } catch (e) { /* ignora */ }
  });

  /* =====================================================
     Modo local
  ===================================================== */
  function renderLocalNames() {
    const box = $('#lc-names');
    box.innerHTML = '';
    localNames.forEach((n, i) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = n;
      inp.maxLength = 14;
      inp.placeholder = `Jogador ${i + 1}`;
      inp.setAttribute('aria-label', `Nome do jogador ${i + 1}`);
      inp.addEventListener('input', () => { localNames[i] = inp.value; });
      box.appendChild(inp);
    });
    $('#lc-count').textContent = localNames.length;
    $('#lc-minus').disabled = localNames.length <= 1;
    $('#lc-plus').disabled = localNames.length >= 16;
  }

  function startLocal() {
    leaving = false;
    mode = 'local'; role = null; myId = null;
    game = newGame('LOCAL');
    const taken = [];
    localNames.forEach((n, i) => {
      const name = uniqueName(sanitizeName(n, `Jogador ${i + 1}`), taken);
      taken.push(name);
      game.players.push({ id: 'p' + i, name, score: 0, connected: true });
    });
    game.settings = {
      maxPlayers: 16,
      rounds: +$('#lc-rounds').value,
      turnTime: +$('#lc-time').value,
      category: $('#lc-cat').value,
    };
    lastMasked = '';
    startGame();
  }

  /* =====================================================
     Inicialização e eventos
  ===================================================== */
  function fillSelect(sel, items, value) {
    const el = $(sel);
    el.innerHTML = items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    el.value = String(value);
  }

  function init() {
    // logo do menu e forca do jogo
    $('#menu-logo').innerHTML = gallowsMarkup(true);
    $('#g-gallows-wrap').innerHTML = gallowsMarkup();
    gallowsSvg = $('#g-gallows-wrap svg');

    // teclado A-Z
    const keys = $('#g-keys');
    ALPHABET.forEach((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = l;
      b.dataset.l = l;
      b.setAttribute('aria-label', `Letra ${l}`);
      b.addEventListener('click', () => requestGuess(l));
      keys.appendChild(b);
    });

    // seletores
    const rounds = [[1, '1 rodada'], [3, '3 rodadas'], [5, '5 rodadas'], [10, '10 rodadas']];
    const times = [[0, 'Sem limite'], [15, '15 segundos'], [30, '30 segundos'], [60, '60 segundos']];
    const cats = [['Todas', 'Todas']].concat(Object.keys(WORDS).map((c) => [c, c]));
    const maxes = Array.from({ length: 15 }, (_, i) => [i + 2, `${i + 2} jogadores`]);
    fillSelect('#lc-rounds', rounds, 3);
    fillSelect('#lc-time', times, 0);
    fillSelect('#lc-cat', cats, 'Todas');
    fillSelect('#lb-max', maxes, 16);
    fillSelect('#lb-rounds', rounds, 3);
    fillSelect('#lb-time', times, 30);
    fillSelect('#lb-cat', cats, 'Todas');

    $('#in-name').value = loadName();
    renderLocalNames();

    // menu
    $('#btn-online').addEventListener('click', () => { setOnlineMsg(''); show('screen-online'); });
    $('#btn-local').addEventListener('click', () => { renderLocalNames(); show('screen-local'); });
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => show('screen-menu')));

    // online
    $('#btn-create').addEventListener('click', () => createRoom());
    $('#btn-join').addEventListener('click', joinRoom);
    $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    $('#in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#in-code').value ? joinRoom() : createRoom(); });

    // sala
    $('#btn-lobby-leave').addEventListener('click', leaveToMenu);
    $('#btn-copy-code').addEventListener('click', () => view && copyText(view.code));
    $('#btn-copy-link').addEventListener('click', () => {
      if (!view) return;
      copyText(`${location.origin === 'null' ? location.href.split('?')[0] : location.origin + location.pathname}?sala=${view.code}`);
    });
    ['#lb-max', '#lb-rounds', '#lb-time', '#lb-cat'].forEach((sel) => $(sel).addEventListener('change', () => {
      if (role !== 'host' || !game || game.phase !== 'lobby') return;
      const max = Math.max(+$('#lb-max').value, game.players.length);
      game.settings = { maxPlayers: max, rounds: +$('#lb-rounds').value, turnTime: +$('#lb-time').value, category: $('#lb-cat').value };
      broadcast();
    }));
    $('#btn-start').addEventListener('click', () => {
      if (role !== 'host' || !game || game.players.length < 2) return;
      lastMasked = '';
      startGame();
    });

    // local
    $('#lc-minus').addEventListener('click', () => { if (localNames.length > 1) { localNames.pop(); renderLocalNames(); } });
    $('#lc-plus').addEventListener('click', () => { if (localNames.length < 16) { localNames.push(`Jogador ${localNames.length + 1}`); renderLocalNames(); } });
    $('#btn-local-start').addEventListener('click', startLocal);

    // jogo
    $('#btn-leave-game').addEventListener('click', () => { if (confirm('Sair da partida?')) leaveToMenu(); });
    $('#btn-next').addEventListener('click', () => { if (isController()) advanceRound(); });
    $('#btn-final-exit').addEventListener('click', leaveToMenu);
    $('#btn-again').addEventListener('click', () => {
      if (!isController() || !game) return;
      lastMasked = '';
      if (mode === 'local') {
        startGame();
      } else {
        game.players = game.players.filter((p) => p.connected);
        game.phase = 'lobby';
        game.word = ''; game.guessed = []; game.wrong = []; game.errors = 0; game.result = null; game.event = '';
        game.players.forEach((p) => (p.score = 0));
        broadcast();
      }
    });

    // chutar palavra
    const openWord = () => {
      if (!meIsTurn(view)) return;
      $('#in-word').value = '';
      $('#ov-word').classList.add('show');
      setTimeout(() => $('#in-word').focus(), 50);
    };
    const sendWord = () => {
      const v = $('#in-word').value.trim();
      if (!v) return;
      $('#ov-word').classList.remove('show');
      act('word', v);
    };
    $('#btn-guess-word').addEventListener('click', openWord);
    $('#btn-word-cancel').addEventListener('click', () => $('#ov-word').classList.remove('show'));
    $('#btn-word-ok').addEventListener('click', sendWord);
    $('#in-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendWord(); if (e.key === 'Escape') $('#ov-word').classList.remove('show'); });

    // teclado físico
    document.addEventListener('keydown', (e) => {
      if (!view || view.phase !== 'playing') return;
      if (!$('#screen-game').classList.contains('active')) return;
      if ($('#ov-word').classList.contains('show')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const l = norm(e.key);
      if (/^[A-Z]$/.test(l)) requestGuess(l);
    });

    // link com ?sala=CODIGO
    const params = new URLSearchParams(location.search);
    const sala = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (sala) {
      $('#in-code').value = sala;
      show('screen-online');
      $('#in-name').focus();
    }
  }

  // Celulares congelam a aba em segundo plano: ao voltar, dá uma folga e pede o estado atual.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || mode !== 'online') return;
    keepAwake();
    if (role === 'client') {
      lastHostMsg = Date.now();
      if (hostConn && hostConn.open) { try { hostConn.send({ t: 'sync' }); } catch (e) { /* ignora */ } }
    } else if (role === 'host') {
      const now = Date.now();
      conns.forEach((c, id) => lastSeen.set(id, now));
      broadcast();
    }
  });

  init();
})();
