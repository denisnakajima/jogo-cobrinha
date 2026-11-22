const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGameState,
  queueDirection,
  stepGame,
  buildGridMatrix,
} = require('../public/snake-engine');

test('cria grid inicial com cobra centralizada de tamanho 3 e comida fora da cobra', () => {
  const state = createGameState({ gridSize: 20 });
  assert.equal(state.gridSize, 20);
  assert.equal(state.snake.length, 3);
  assert.deepEqual(state.snake[0], { x: 10, y: 10 });
  assert.ok(state.food);

  const overlapsSnake = state.snake.some(
    (s) => s.x === state.food.x && s.y === state.food.y
  );
  assert.equal(overlapsSnake, false);

  const matrix = buildGridMatrix(state);
  assert.equal(matrix.length, 20);
  assert.equal(matrix[0].length, 20);
  assert.equal(matrix[10][10], 'head');
  assert.equal(matrix[10][9], 'body');
  assert.equal(matrix[10][8], 'tail');
  assert.equal(matrix[state.food.y][state.food.x], 'food');
});

test('impede inversão instantânea de 180 graus na fila de direções', () => {
  const state = createGameState({ gridSize: 15 });
  state.status = 'running';

  // Indo para RIGHT, tentar ir para LEFT deve ser ignorado
  queueDirection(state, 'LEFT');
  assert.equal(state.directionQueue.length, 0);

  // Mas UP seguido de LEFT em sequência rápida deve enfileirar ambos com segurança
  queueDirection(state, 'UP');
  queueDirection(state, 'LEFT');
  assert.deepEqual(state.directionQueue, ['UP', 'LEFT']);
});

test('cresce ao comer maçã, soma pontos e gera fruta bônus na 5ª maçã', () => {
  const state = createGameState({
    gridSize: 15,
    speed: 'normal',
    initialFood: { x: 8, y: 7 },
  });
  state.status = 'running';

  // Posiciona cabeça exatamente à esquerda da comida
  state.snake = [
    { x: 7, y: 7 },
    { x: 6, y: 7 },
    { x: 5, y: 7 },
  ];
  state.apples = 4; // Próxima maçã será a 5ª

  const { events } = stepGame(state);
  assert.ok(events.includes('eat:food'));
  assert.ok(events.includes('bonus:spawned'));
  assert.equal(state.snake.length, 4);
  assert.equal(state.apples, 5);
  assert.equal(state.score, 10);
  assert.ok(state.bonusFood);
});

test('detecta colisão na parede no modo solid e atravessa bordas no modo wrap', () => {
  const solidState = createGameState({
    gridSize: 10,
    wallMode: 'solid',
    initialFood: { x: 0, y: 0 },
  });
  solidState.status = 'running';
  solidState.snake = [
    { x: 9, y: 5 },
    { x: 8, y: 5 },
    { x: 7, y: 5 },
  ];

  stepGame(solidState);
  assert.equal(solidState.status, 'gameover');
  assert.equal(solidState.cause, 'wall');

  const wrapState = createGameState({
    gridSize: 10,
    wallMode: 'wrap',
    initialFood: { x: 2, y: 2 },
  });
  wrapState.status = 'running';
  wrapState.snake = [
    { x: 9, y: 5 },
    { x: 8, y: 5 },
    { x: 7, y: 5 },
  ];

  stepGame(wrapState);
  assert.equal(wrapState.status, 'running');
  assert.deepEqual(wrapState.snake[0], { x: 0, y: 5 });
});

test('detecta autocolisão quando a cabeça atinge o próprio corpo', () => {
  const state = createGameState({
    gridSize: 12,
    initialFood: { x: 0, y: 0 },
  });
  state.status = 'running';
  state.direction = 'UP';
  state.snake = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 4 },
    { x: 5, y: 4 }, // Célula destino de UP
    { x: 4, y: 4 },
  ];

  const { events } = stepGame(state);
  assert.ok(events.includes('collision:self'));
  assert.equal(state.status, 'gameover');
  assert.equal(state.cause, 'self');
});
