(() => {
  const {
    createGameState,
    queueDirection,
    stepGame,
    formatCauseLabel,
    SPEED_PRESETS,
  } = window.SnakeEngine;

  // Elementos da UI
  const gridEl = document.getElementById('snake-grid');
  const boardWrapperEl = document.querySelector('.board-wrapper');
  const axisTopEl = document.getElementById('axis-top');
  const axisLeftEl = document.getElementById('axis-left');
  const cellInspectorEl = document.getElementById('cell-inspector');

  const playerInput = document.getElementById('player-input');
  const soundBtn = document.getElementById('sound-btn');
  const gridSizeSelect = document.getElementById('grid-size-select');
  const speedSelect = document.getElementById('speed-select');
  const wallModeSelect = document.getElementById('wall-mode-select');
  const toggleGridLines = document.getElementById('toggle-grid-lines');
  const toggleRulers = document.getElementById('toggle-rulers');

  const hudScore = document.getElementById('hud-score');
  const hudBest = document.getElementById('hud-best');
  const hudLength = document.getElementById('hud-length');
  const hudCoords = document.getElementById('hud-coords');
  const hudTime = document.getElementById('hud-time');

  const bonusBanner = document.getElementById('bonus-banner');
  const bonusProgressFill = document.getElementById('bonus-progress-fill');

  const overlayEl = document.getElementById('board-overlay');
  const overlayBadge = document.getElementById('overlay-badge');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySubtitle = document.getElementById('overlay-subtitle');
  const overlaySummary = document.getElementById('overlay-summary');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const btnRestart = document.getElementById('btn-restart');

  const statTotal = document.getElementById('stat-total');
  const statAvg = document.getElementById('stat-avg');
  const statMaxLen = document.getElementById('stat-maxlen');
  const statApples = document.getElementById('stat-apples');

  const tabHistory = document.getElementById('tab-history');
  const tabLeaderboard = document.getElementById('tab-leaderboard');
  const historyGridFilter = document.getElementById('history-grid-filter');
  const historyListEl = document.getElementById('history-list');
  const leaderboardListEl = document.getElementById('leaderboard-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  // Estado local da aplicação
  let gameState = null;
  let cellMatrix = [];
  let paintedCells = [];
  let tickTimer = null;
  let clockInterval = null;
  let activeElapsedMs = 0;
  let lastResumeTimestamp = null;
  let lastSavedMatchId = null;
  let serverBestScore = 0;
  let soundEnabled = localStorage.getItem('snake_sound') !== 'off';
  let audioCtx = null;

  // Inicializa nome salvo
  const savedPlayer = localStorage.getItem('snake_player_name');
  if (savedPlayer) {
    playerInput.value = savedPlayer;
  }

  function updateSoundButtonUI() {
    soundBtn.textContent = soundEnabled ? '🔊 Som' : '🔇 Mudo';
    soundBtn.classList.toggle('muted', !soundEnabled);
  }
  updateSoundButtonUI();

  // Sintetizador simples Web Audio (zero arquivos externos)
  function playSound(type) {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'eat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'bonus') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587, now);
        osc.frequency.setValueAtTime(784, now + 0.06);
        osc.frequency.setValueAtTime(1046, now + 0.12);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'gameover') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.28);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'won') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523, now);
        osc.frequency.setValueAtTime(659, now + 0.08);
        osc.frequency.setValueAtTime(784, now + 0.16);
        osc.frequency.setValueAtTime(1046, now + 0.24);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch {
      // Ignora falhas de política de áudio do navegador
    }
  }

  function formatDuration(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function getElapsedSeconds() {
    let totalMs = activeElapsedMs;
    if (gameState && gameState.status === 'running' && lastResumeTimestamp !== null) {
      totalMs += performance.now() - lastResumeTimestamp;
    }
    return Math.floor(totalMs / 1000);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  // Constrói o Grid DOM e os eixos X/Y
  function buildGridDOM(size) {
    document.documentElement.style.setProperty('--grid-size', String(size));
    gridEl.innerHTML = '';
    axisTopEl.innerHTML = '';
    axisLeftEl.innerHTML = '';
    cellMatrix = Array.from({ length: size }, () => Array(size));
    paintedCells = [];

    for (let x = 0; x < size; x += 1) {
      const colLabel = document.createElement('span');
      colLabel.textContent = x;
      axisTopEl.appendChild(colLabel);
    }

    for (let y = 0; y < size; y += 1) {
      const rowLabel = document.createElement('span');
      rowLabel.textContent = y;
      axisLeftEl.appendChild(rowLabel);

      for (let x = 0; x < size; x += 1) {
        const cell = document.createElement('div');
        const isAlt = (x + y) % 2 === 1;
        cell.className = isAlt ? 'grid-cell alt' : 'grid-cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        cellMatrix[y][x] = cell;
        gridEl.appendChild(cell);
      }
    }
  }

  const DYNAMIC_CLASSES = [
    'snake-head',
    'snake-body',
    'snake-tail',
    'food',
    'bonus',
    'dir-UP',
    'dir-DOWN',
    'dir-LEFT',
    'dir-RIGHT',
  ];

  function renderBoard() {
    for (let i = 0; i < paintedCells.length; i += 1) {
      paintedCells[i].classList.remove(...DYNAMIC_CLASSES);
    }
    paintedCells = [];

    if (gameState.food) {
      const fCell = cellMatrix[gameState.food.y]?.[gameState.food.x];
      if (fCell) {
        fCell.classList.add('food');
        paintedCells.push(fCell);
      }
    }

    if (gameState.bonusFood) {
      const bCell = cellMatrix[gameState.bonusFood.y]?.[gameState.bonusFood.x];
      if (bCell) {
        bCell.classList.add('bonus');
        paintedCells.push(bCell);
      }
      bonusBanner.classList.remove('hidden');
      const pct = Math.max(
        0,
        Math.min(100, (gameState.bonusFood.ticksLeft / gameState.bonusFood.maxTicks) * 100)
      );
      bonusProgressFill.style.width = `${pct}%`;
    } else {
      bonusBanner.classList.add('hidden');
    }

    const len = gameState.snake.length;
    for (let i = len - 1; i >= 0; i -= 1) {
      const seg = gameState.snake[i];
      const sCell = cellMatrix[seg.y]?.[seg.x];
      if (!sCell) continue;

      if (i === 0) {
        sCell.classList.remove('snake-body', 'snake-tail');
        sCell.classList.add('snake-head', `dir-${gameState.direction}`);
      } else if (i === len - 1) {
        sCell.classList.add('snake-tail');
      } else {
        sCell.classList.add('snake-body');
      }
      paintedCells.push(sCell);
    }

    // Atualiza HUD
    hudScore.textContent = String(gameState.score);
    const liveBest = Math.max(serverBestScore, gameState.score);
    hudBest.textContent = String(liveBest);

    const totalCells = gameState.gridSize * gameState.gridSize;
    hudLength.textContent = `${len} / ${totalCells}`;

    const head = gameState.snake[0];
    hudCoords.textContent = `(${head.x}, ${head.y})`;
    hudTime.textContent = formatDuration(getElapsedSeconds());
  }

  function stopLoops() {
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function initNewGame(autoStart = false) {
    stopLoops();
    const gridSize = Number(gridSizeSelect.value) || 20;
    const speed = speedSelect.value || 'normal';
    const wallMode = wallModeSelect.value || 'solid';

    boardWrapperEl.classList.toggle('wrap-mode', wallMode === 'wrap');

    if (cellMatrix.length !== gridSize) {
      buildGridDOM(gridSize);
    }

    gameState = createGameState({ gridSize, speed, wallMode });
    activeElapsedMs = 0;
    lastResumeTimestamp = null;

    renderBoard();

    if (autoStart) {
      startRunning();
    } else {
      showOverlay('idle');
    }
  }

  function showOverlay(mode, extra = {}) {
    overlayEl.classList.remove('hidden');
    overlayBadge.classList.add('hidden');
    overlaySummary.classList.add('hidden');
    pauseBtn.classList.add('hidden');

    if (mode === 'idle') {
      overlayTitle.textContent = 'Pronto para Jogar?';
      overlaySubtitle.innerHTML =
        'Use as <strong>Setas</strong> ou <strong>WASD</strong> para mover a cobrinha pelo Grid.';
      startBtn.textContent = '▶ Iniciar Partida';
      startBtn.classList.remove('hidden');
    } else if (mode === 'paused') {
      overlayTitle.textContent = 'Jogo Pausado';
      overlaySubtitle.textContent = 'Pressione Espaço ou clique abaixo para retomar a partida.';
      startBtn.classList.add('hidden');
      pauseBtn.textContent = '▶ Continuar';
      pauseBtn.classList.remove('hidden');
    } else if (mode === 'gameover' || mode === 'won') {
      const isWin = mode === 'won';
      overlayTitle.textContent = isWin ? '🏆 Grid Completo!' : 'Fim de Jogo!';
      overlaySubtitle.textContent = formatCauseLabel(gameState.cause);

      if (extra.isNewRecord) {
        overlayBadge.textContent = '🔥 NOVO RECORDE GERAL!';
        overlayBadge.classList.remove('hidden');
      } else if (extra.rank && extra.rank <= 3) {
        overlayBadge.textContent = `🏅 TOP #${extra.rank} NO RANKING!`;
        overlayBadge.classList.remove('hidden');
      }

      const duration = formatDuration(extra.durationSec ?? getElapsedSeconds());
      overlaySummary.innerHTML = `
        <div class="summary-chip"><span>Pontuação</span><strong>${gameState.score} pts</strong></div>
        <div class="summary-chip"><span>Tamanho Final</span><strong>${gameState.snake.length} células</strong></div>
        <div class="summary-chip"><span>Maçãs Comidas</span><strong>🍎 ${gameState.apples}</strong></div>
        <div class="summary-chip"><span>Grid / Tempo</span><strong>${gameState.gridSize}×${gameState.gridSize} • ${duration}</strong></div>
      `;
      overlaySummary.classList.remove('hidden');

      startBtn.textContent = '↻ Jogar Novamente';
      startBtn.classList.remove('hidden');
    }
  }

  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  function scheduleNextTick() {
    if (!gameState || gameState.status !== 'running') return;
    tickTimer = setTimeout(() => {
      const { events } = stepGame(gameState);

      if (events.includes('eat:bonus')) {
        playSound('bonus');
      } else if (events.includes('eat:food')) {
        playSound('eat');
      }

      renderBoard();

      if (gameState.status === 'gameover' || gameState.status === 'won') {
        handleMatchFinished();
        return;
      }

      scheduleNextTick();
    }, gameState.tickMs);
  }

  function startRunning() {
    if (!gameState) return;
    if (gameState.status === 'gameover' || gameState.status === 'won') {
      initNewGame(true);
      return;
    }

    gameState.status = 'running';
    lastResumeTimestamp = performance.now();
    hideOverlay();
    btnPlayPause.textContent = '⏸ Pausar (Espaço)';

    stopLoops();
    clockInterval = setInterval(() => {
      hudTime.textContent = formatDuration(getElapsedSeconds());
    }, 250);

    scheduleNextTick();
  }

  function pauseRunning() {
    if (!gameState || gameState.status !== 'running') return;
    if (lastResumeTimestamp !== null) {
      activeElapsedMs += performance.now() - lastResumeTimestamp;
      lastResumeTimestamp = null;
    }
    gameState.status = 'paused';
    stopLoops();
    btnPlayPause.textContent = '▶ Continuar (Espaço)';
    showOverlay('paused');
  }

  function togglePlayPause() {
    if (!gameState) return;
    if (gameState.status === 'running') {
      pauseRunning();
    } else if (gameState.status === 'paused' || gameState.status === 'idle') {
      startRunning();
    } else {
      initNewGame(true);
    }
  }

  async function handleMatchFinished() {
    if (lastResumeTimestamp !== null) {
      activeElapsedMs += performance.now() - lastResumeTimestamp;
      lastResumeTimestamp = null;
    }
    stopLoops();
    btnPlayPause.textContent = '▶ Nova Partida (Espaço)';

    const durationSec = getElapsedSeconds();
    playSound(gameState.status === 'won' ? 'won' : 'gameover');

    showOverlay(gameState.status, { durationSec });

    // Salva partida no Histórico Node.js
    const playerName = (playerInput.value || '').trim() || 'Jogador 1';
    localStorage.setItem('snake_player_name', playerName);

    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: playerName,
          score: gameState.score,
          apples: gameState.apples,
          bonusEaten: gameState.bonusEaten,
          length: gameState.snake.length,
          gridSize: gameState.gridSize,
          speed: gameState.speed,
          wallMode: gameState.wallMode,
          cause: gameState.cause,
          durationSec,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        lastSavedMatchId = result.entry?.id || null;

        showOverlay(gameState.status, {
          durationSec,
          isNewRecord: result.isNewRecord,
          rank: result.rank,
        });

        const activeGridFilter = historyGridFilter.value;
        if (activeGridFilter) {
          await fetchHistory();
        } else {
          applyHistoryPayload(result);
        }
      }
    } catch {
      // Mantém overlay local caso offline
    }
  }

  // API de Histórico e Ranking
  function formatDateTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function applyHistoryPayload(payload) {
    const stats = payload.stats || {};
    serverBestScore = stats.highScore || 0;
    hudBest.textContent = String(Math.max(serverBestScore, gameState ? gameState.score : 0));

    statTotal.textContent = String(stats.totalMatches || 0);
    statAvg.textContent = String(stats.averageScore || 0);
    statMaxLen.textContent = String(stats.maxLength || 0);
    statApples.textContent = String(stats.totalApples || 0);

    renderHistoryItems(payload.history || []);
    renderLeaderboardItems(payload.leaderboard || []);
  }

  function renderHistoryItems(items) {
    if (!items.length) {
      historyListEl.innerHTML =
        '<div class="empty-state">Nenhuma partida registrada ainda. Jogue uma rodada para estrear o histórico!</div>';
      return;
    }

    historyListEl.innerHTML = items
      .map((item) => {
        const isRecent = item.id === lastSavedMatchId;
        const wallBadge = item.wallMode === 'wrap' ? 'Bordas Livres' : 'Paredes';
        const speedLabel = item.speedLabel || SPEED_PRESETS[item.speed]?.label || 'Normal';
        return `
          <article class="history-item ${isRecent ? 'recent-highlight' : ''}">
            <div class="history-top">
              <span class="history-player">🐍 ${escapeHtml(item.player)}</span>
              <span class="history-score">${item.score} pts</span>
            </div>
            <div class="history-meta">
              <span class="badge">Grid ${item.gridSize}×${item.gridSize}</span>
              <span class="badge">Tam: ${item.length}</span>
              <span class="badge">🍎 ${item.apples}</span>
              <span class="badge">${escapeHtml(speedLabel)}</span>
              <span class="badge">${wallBadge}</span>
              <span class="badge">⏱ ${formatDuration(item.durationSec)}</span>
              <span class="badge cause-${escapeHtml(item.cause)}">${escapeHtml(item.causeLabel)}</span>
            </div>
            <div class="history-time">${formatDateTime(item.createdAt)}</div>
          </article>
        `;
      })
      .join('');
  }

  function renderLeaderboardItems(items) {
    if (!items.length) {
      leaderboardListEl.innerHTML =
        '<div class="empty-state">Sem pontuações no ranking ainda.</div>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    leaderboardListEl.innerHTML = items
      .map((item, idx) => {
        const rankDisplay = medals[idx] || `#${idx + 1}`;
        return `
          <article class="history-item ${item.id === lastSavedMatchId ? 'recent-highlight' : ''}">
            <div class="history-top">
              <span class="history-player">${rankDisplay} ${escapeHtml(item.player)}</span>
              <span class="history-score">${item.score} pts</span>
            </div>
            <div class="history-meta">
              <span class="badge">Grid ${item.gridSize}×${item.gridSize}</span>
              <span class="badge">Tam: ${item.length}</span>
              <span class="badge">🍎 ${item.apples}</span>
              <span class="badge">⏱ ${formatDuration(item.durationSec)}</span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  async function fetchHistory() {
    try {
      const gridFilter = historyGridFilter.value;
      const query = gridFilter ? `?gridSize=${encodeURIComponent(gridFilter)}` : '';
      const res = await fetch(`/api/history${query}`);
      if (!res.ok) return;
      const data = await res.json();
      applyHistoryPayload(data);
    } catch {
      historyListEl.innerHTML =
        '<div class="empty-state">Não foi possível carregar o histórico do servidor.</div>';
    }
  }

  // Direção via teclado / botões
  function handleDirectionInput(dirName) {
    if (!gameState) return;
    if (gameState.status === 'idle') {
      queueDirection(gameState, dirName);
      startRunning();
      return;
    }
    if (gameState.status === 'running') {
      queueDirection(gameState, dirName);
    }
  }

  const KEY_TO_DIR = {
    ArrowUp: 'UP',
    KeyW: 'UP',
    ArrowDown: 'DOWN',
    KeyS: 'DOWN',
    ArrowLeft: 'LEFT',
    KeyA: 'LEFT',
    ArrowRight: 'RIGHT',
    KeyD: 'RIGHT',
  };

  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') {
      if (e.key === 'Enter') {
        document.activeElement.blur();
      }
      return;
    }

    const mappedDir = KEY_TO_DIR[e.code] || KEY_TO_DIR[e.key];
    if (mappedDir) {
      e.preventDefault();
      handleDirectionInput(mappedDir);
      return;
    }

    if (e.code === 'Space' || e.code === 'KeyP') {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    if (e.code === 'KeyR') {
      e.preventDefault();
      initNewGame(true);
    }
  });

  // Botões do D-Pad
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir;
      if (dir) handleDirectionInput(dir);
    });
  });

  // Suporte a gestos de Swipe no Grid (mobile)
  let touchStartX = null;
  let touchStartY = null;

  gridEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    },
    { passive: true }
  );

  gridEl.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null || touchStartY === null || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;

      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        handleDirectionInput(dx > 0 ? 'RIGHT' : 'LEFT');
      } else {
        handleDirectionInput(dy > 0 ? 'DOWN' : 'UP');
      }
    },
    { passive: true }
  );

  // Inspetor de coordenadas (x, y) do Grid
  gridEl.addEventListener('mousemove', (e) => {
    const cell = e.target.closest('.grid-cell');
    if (!cell) return;
    cellInspectorEl.textContent = `Célula do Grid: (x: ${cell.dataset.x}, y: ${cell.dataset.y})`;
  });

  gridEl.addEventListener('mouseleave', () => {
    cellInspectorEl.textContent = 'Passe o mouse no Grid para inspecionar (x, y)';
  });

  // Eventos de UI e controles
  startBtn.addEventListener('click', () => startRunning());
  pauseBtn.addEventListener('click', () => startRunning());
  btnPlayPause.addEventListener('click', () => togglePlayPause());
  btnRestart.addEventListener('click', () => initNewGame(true));

  playerInput.addEventListener('change', () => {
    const val = playerInput.value.trim();
    if (val) localStorage.setItem('snake_player_name', val);
  });

  soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('snake_sound', soundEnabled ? 'on' : 'off');
    updateSoundButtonUI();
  });

  gridSizeSelect.addEventListener('change', () => initNewGame(false));
  speedSelect.addEventListener('change', () => initNewGame(false));
  wallModeSelect.addEventListener('change', () => initNewGame(false));

  toggleGridLines.addEventListener('change', () => {
    gridEl.classList.toggle('show-lines', toggleGridLines.checked);
  });

  toggleRulers.addEventListener('change', () => {
    const hide = !toggleRulers.checked;
    axisTopEl.classList.toggle('rulers-hidden', hide);
    axisLeftEl.classList.toggle('rulers-hidden', hide);
  });

  // Abas Histórico vs Top 10
  tabHistory.addEventListener('click', () => {
    tabHistory.classList.add('active');
    tabHistory.setAttribute('aria-selected', 'true');
    tabLeaderboard.classList.remove('active');
    tabLeaderboard.setAttribute('aria-selected', 'false');
    historyListEl.classList.remove('hidden');
    leaderboardListEl.classList.add('hidden');
  });

  tabLeaderboard.addEventListener('click', () => {
    tabLeaderboard.classList.add('active');
    tabLeaderboard.setAttribute('aria-selected', 'true');
    tabHistory.classList.remove('active');
    tabHistory.setAttribute('aria-selected', 'false');
    leaderboardListEl.classList.remove('hidden');
    historyListEl.classList.add('hidden');
  });

  historyGridFilter.addEventListener('change', () => {
    fetchHistory();
  });

  clearHistoryBtn.addEventListener('click', async () => {
    if (!window.confirm('Deseja realmente apagar todo o histórico de partidas?')) {
      return;
    }
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (res.ok) {
        lastSavedMatchId = null;
        const cleared = await res.json();
        applyHistoryPayload(cleared);
      }
    } catch {
      // Ignora erro de rede
    }
  });

  // Inicialização
  initNewGame(false);
  fetchHistory();
})();
