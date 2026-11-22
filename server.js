const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { formatCauseLabel, SPEED_PRESETS, clampGridSize } = require('./public/snake-engine');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const MAX_STORED_HISTORY = 100;
const MAX_LEADERBOARD = 10;
const MAX_BODY_BYTES = 16 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const VALID_CAUSES = new Set(['wall', 'self', 'won', 'quit']);
const VALID_WALL_MODES = new Set(['solid', 'wrap']);

function sanitizePlayerName(raw) {
  if (typeof raw !== 'string') return 'Jogador 1';
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_.-]/gu, '')
    .trim()
    .slice(0, 18);
  return cleaned || 'Jogador 1';
}

function computeSummary(records) {
  if (!records.length) {
    return {
      totalMatches: 0,
      highScore: 0,
      bestPlayer: null,
      maxLength: 0,
      totalApples: 0,
      averageScore: 0,
    };
  }

  let highScore = -1;
  let bestPlayer = null;
  let maxLength = 0;
  let totalApples = 0;
  let totalScore = 0;

  for (const item of records) {
    totalScore += item.score;
    totalApples += item.apples;
    if (item.length > maxLength) {
      maxLength = item.length;
    }
    if (item.score > highScore) {
      highScore = item.score;
      bestPlayer = item.player;
    }
  }

  return {
    totalMatches: records.length,
    highScore: Math.max(0, highScore),
    bestPlayer,
    maxLength,
    totalApples,
    averageScore: Math.round(totalScore / records.length),
  };
}

function computeLeaderboard(records) {
  return [...records]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.length !== a.length) return b.length - a.length;
      return a.durationSec - b.durationSec;
    })
    .slice(0, MAX_LEADERBOARD);
}

function createHistoryStore(historyFile = DEFAULT_HISTORY_FILE) {
  let writeQueue = Promise.resolve();

  async function ensureFile() {
    const dir = path.dirname(historyFile);
    await fsp.mkdir(dir, { recursive: true });
    if (!fs.existsSync(historyFile)) {
      await fsp.writeFile(historyFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  async function readAllRecords() {
    await ensureFile();
    try {
      const raw = await fsp.readFile(historyFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.player === 'string' &&
          Number.isFinite(item.score)
      );
    } catch {
      return [];
    }
  }

  async function getPayload(filterOptions = {}) {
    const allRecords = await readAllRecords();
    const gridFilter = filterOptions.gridSize ? Number(filterOptions.gridSize) : null;
    const limit = Math.min(
      MAX_STORED_HISTORY,
      Math.max(1, Number(filterOptions.limit) || 50)
    );

    const filtered = gridFilter
      ? allRecords.filter((item) => item.gridSize === gridFilter)
      : allRecords;

    return {
      history: filtered.slice(0, limit),
      leaderboard: computeLeaderboard(filtered),
      stats: computeSummary(filtered),
    };
  }

  function addMatch(input = {}) {
    const run = async () => {
      const records = await readAllRecords();
      const previousBest = records.reduce((max, r) => Math.max(max, r.score), 0);

      const player = sanitizePlayerName(input.player);
      const score = Math.max(0, Math.min(999999, Math.floor(Number(input.score) || 0)));
      const apples = Math.max(0, Math.min(99999, Math.floor(Number(input.apples) || 0)));
      const bonusEaten = Math.max(0, Math.min(9999, Math.floor(Number(input.bonusEaten) || 0)));
      const gridSize = clampGridSize(input.gridSize || 20);
      const length = Math.max(
        1,
        Math.min(gridSize * gridSize, Math.floor(Number(input.length) || 3 + apples))
      );
      const speed = SPEED_PRESETS[input.speed] ? input.speed : 'normal';
      const wallMode = VALID_WALL_MODES.has(input.wallMode) ? input.wallMode : 'solid';
      const cause = VALID_CAUSES.has(input.cause) ? input.cause : 'wall';
      const durationSec = Math.max(
        0,
        Math.min(86400, Math.round(Number(input.durationSec) || 0))
      );

      const entry = {
        id: crypto.randomUUID(),
        player,
        score,
        apples,
        bonusEaten,
        length,
        gridSize,
        speed,
        speedLabel: SPEED_PRESETS[speed].label,
        wallMode,
        cause,
        causeLabel: formatCauseLabel(cause),
        durationSec,
        createdAt: new Date().toISOString(),
      };

      const updated = [entry, ...records].slice(0, MAX_STORED_HISTORY);
      await fsp.writeFile(historyFile, JSON.stringify(updated, null, 2), 'utf8');

      const leaderboard = computeLeaderboard(updated);
      const rankIdx = leaderboard.findIndex((item) => item.id === entry.id);

      return {
        entry,
        history: updated.slice(0, 50),
        leaderboard,
        stats: computeSummary(updated),
        isNewRecord: score > 0 && score > previousBest,
        rank: rankIdx === -1 ? null : rankIdx + 1,
      };
    };

    writeQueue = writeQueue.then(run, run);
    return writeQueue;
  }

  function clearHistory() {
    const run = async () => {
      await ensureFile();
      await fsp.writeFile(historyFile, JSON.stringify([], null, 2), 'utf8');
      return {
        history: [],
        leaderboard: [],
        stats: computeSummary([]),
      };
    };

    writeQueue = writeQueue.then(run, run);
    return writeQueue;
  }

  return {
    getPayload,
    addMatch,
    clearHistory,
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        const err = new Error('Payload muito grande.');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      raw += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('JSON inválido.');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

async function serveStaticFile(reqPath, method, res) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const decodedPath = decodeURIComponent(cleanPath);
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  const relative = path.relative(PUBLIC_DIR, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(res, 403, { error: 'Acesso negado.' });
    return;
  }

  try {
    const stat = await fsp.stat(resolvedPath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fsp.readFile(resolvedPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
    });

    if (method === 'HEAD') {
      res.end();
      return;
    }

    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  }
}

function createAppServer(options = {}) {
  const historyStore = createHistoryStore(options.historyFile || DEFAULT_HISTORY_FILE);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/history') {
        if (req.method === 'GET') {
          const gridSize = url.searchParams.get('gridSize');
          const limit = url.searchParams.get('limit');
          const payload = await historyStore.getPayload({ gridSize, limit });
          sendJson(res, 200, payload);
          return;
        }

        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          if (body.score !== undefined && (!Number.isFinite(Number(body.score)) || Number(body.score) < 0)) {
            sendJson(res, 400, { error: 'Pontuação inválida.' });
            return;
          }
          const saved = await historyStore.addMatch(body);
          sendJson(res, 201, saved);
          return;
        }

        if (req.method === 'DELETE') {
          const cleared = await historyStore.clearHistory();
          sendJson(res, 200, cleared);
          return;
        }

        sendJson(res, 405, { error: 'Método não permitido.' });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Rota da API não encontrada.' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Método não permitido.' });
        return;
      }

      await serveStaticFile(pathname, req.method, res);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      sendJson(res, statusCode, {
        error: err.message || 'Erro interno no servidor.',
      });
    }
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`🐍 Jogo da Cobrinha rodando em http://localhost:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createAppServer,
  createHistoryStore,
};
