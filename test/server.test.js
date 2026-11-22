const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createAppServer } = require('../server');

async function withTestServer(fn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snake-history-test-'));
  const historyFile = path.join(tmpDir, 'history.json');
  const server = createAppServer({ historyFile });

  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\snake-test-${crypto.randomUUID()}`
      : path.join(tmpDir, 'server.sock');

  await new Promise((resolve) => server.listen(socketPath, resolve));

  function request(urlPath, { method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const req = http.request(
        {
          socketPath,
          path: urlPath,
          method,
          headers: payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {},
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text,
              json: () => JSON.parse(text),
            });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    await fn(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('serve interface estática e bloqueia tentativa de path traversal', async () => {
  await withTestServer(async (request) => {
    const htmlRes = await request('/');
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers['content-type'] || '', /text\/html/);
    assert.ok(htmlRes.text.includes('Jogo da Cobrinha'));

    const engineRes = await request('/snake-engine.js');
    assert.equal(engineRes.status, 200);
    assert.match(engineRes.headers['content-type'] || '', /javascript/);

    const traversalRes = await request('/..%2Fpackage.json');
    assert.equal(traversalRes.status, 403);
  });
});

test('gerencia histórico de partidas, filtro por grid, ranking e limpeza via API', async () => {
  await withTestServer(async (request) => {
    // 1. Histórico inicial vazio
    const initialRes = await request('/api/history');
    assert.equal(initialRes.status, 200);
    const initialData = initialRes.json();
    assert.equal(initialData.history.length, 0);
    assert.equal(initialData.stats.totalMatches, 0);

    // 2. Registra duas partidas em grids diferentes
    const post1 = await request('/api/history', {
      method: 'POST',
      body: {
        player: 'Ana',
        score: 80,
        apples: 8,
        length: 11,
        gridSize: 20,
        speed: 'normal',
        wallMode: 'solid',
        cause: 'wall',
        durationSec: 42,
      },
    });
    assert.equal(post1.status, 201);
    const saved1 = post1.json();
    assert.equal(saved1.isNewRecord, true);
    assert.equal(saved1.rank, 1);

    const post2 = await request('/api/history', {
      method: 'POST',
      body: {
        player: 'Carlos',
        score: 150,
        apples: 12,
        bonusEaten: 1,
        length: 16,
        gridSize: 15,
        speed: 'fast',
        wallMode: 'wrap',
        cause: 'self',
        durationSec: 65,
      },
    });
    assert.equal(post2.status, 201);
    const saved2 = post2.json();
    assert.equal(saved2.isNewRecord, true);
    assert.equal(saved2.stats.totalMatches, 2);
    assert.equal(saved2.stats.highScore, 150);
    assert.equal(saved2.leaderboard[0].player, 'Carlos');

    // 3. Filtra histórico por tamanho do Grid (15x15)
    const filterRes = await request('/api/history?gridSize=15');
    assert.equal(filterRes.status, 200);
    const filterData = filterRes.json();
    assert.equal(filterData.history.length, 1);
    assert.equal(filterData.history[0].player, 'Carlos');

    // 4. Limpa histórico via DELETE
    const delRes = await request('/api/history', { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const delData = delRes.json();
    assert.equal(delData.history.length, 0);
    assert.equal(delData.stats.totalMatches, 0);
  });
});
