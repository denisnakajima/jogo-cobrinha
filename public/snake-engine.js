(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.SnakeEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DIRECTIONS = {
    UP: { x: 0, y: -1, name: 'UP' },
    DOWN: { x: 0, y: 1, name: 'DOWN' },
    LEFT: { x: -1, y: 0, name: 'LEFT' },
    RIGHT: { x: 1, y: 0, name: 'RIGHT' },
  };

  const OPPOSITE = {
    UP: 'DOWN',
    DOWN: 'UP',
    LEFT: 'RIGHT',
    RIGHT: 'LEFT',
  };

  const SPEED_PRESETS = {
    slow: { label: 'Lento', baseTickMs: 165, minTickMs: 95, scoreMultiplier: 1 },
    normal: { label: 'Normal', baseTickMs: 120, minTickMs: 65, scoreMultiplier: 1 },
    fast: { label: 'Rápido', baseTickMs: 85, minTickMs: 48, scoreMultiplier: 1.5 },
    insane: { label: 'Insano', baseTickMs: 60, minTickMs: 36, scoreMultiplier: 2 },
  };

  function clampGridSize(size) {
    const n = Math.floor(Number(size) || 20);
    if (n < 8) return 8;
    if (n > 40) return 40;
    return n;
  }

  function isSameCell(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y);
  }

  function getFreeCells(gridSize, occupiedCells) {
    const occupied = new Set(occupiedCells.map((c) => `${c.x},${c.y}`));
    const free = [];
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        if (!occupied.has(`${x},${y}`)) {
          free.push({ x, y });
        }
      }
    }
    return free;
  }

  function spawnRandomCell(gridSize, occupiedCells, rng = Math.random) {
    const free = getFreeCells(gridSize, occupiedCells);
    if (free.length === 0) return null;
    const idx = Math.min(free.length - 1, Math.floor(rng() * free.length));
    return free[idx];
  }

  function computeTickMs(speedKey, apples) {
    const preset = SPEED_PRESETS[speedKey] || SPEED_PRESETS.normal;
    const reduction = Math.floor(apples / 3) * 4;
    return Math.max(preset.minTickMs, preset.baseTickMs - reduction);
  }

  function createGameState(options = {}) {
    const gridSize = clampGridSize(options.gridSize || 20);
    const speed = SPEED_PRESETS[options.speed] ? options.speed : 'normal';
    const wallMode = options.wallMode === 'wrap' ? 'wrap' : 'solid';
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;

    const centerY = Math.floor(gridSize / 2);
    const centerX = Math.floor(gridSize / 2);

    const snake = [
      { x: centerX, y: centerY },
      { x: centerX - 1, y: centerY },
      { x: centerX - 2, y: centerY },
    ];

    const food = options.initialFood || spawnRandomCell(gridSize, snake, rng);

    return {
      gridSize,
      speed,
      wallMode,
      status: 'idle', // 'idle' | 'running' | 'paused' | 'gameover' | 'won'
      cause: null, // 'wall' | 'self' | 'won' | 'quit' | null
      direction: 'RIGHT',
      directionQueue: [],
      snake,
      food,
      bonusFood: null, // { x, y, ticksLeft, maxTicks }
      score: 0,
      apples: 0,
      bonusEaten: 0,
      ticks: 0,
      tickMs: computeTickMs(speed, 0),
    };
  }

  function queueDirection(state, nextDirName) {
    const dir = DIRECTIONS[nextDirName];
    if (!dir) return state;
    if (state.status === 'gameover' || state.status === 'won') return state;

    const lastPlanned =
      state.directionQueue.length > 0
        ? state.directionQueue[state.directionQueue.length - 1]
        : state.direction;

    if (nextDirName === lastPlanned || OPPOSITE[lastPlanned] === nextDirName) {
      return state;
    }

    if (state.directionQueue.length < 2) {
      state.directionQueue.push(nextDirName);
    }
    return state;
  }

  function stepGame(state, rng = Math.random) {
    if (state.status !== 'running') {
      return { state, events: [] };
    }

    const events = [];

    if (state.directionQueue.length > 0) {
      state.direction = state.directionQueue.shift();
    }

    const vector = DIRECTIONS[state.direction];
    const currentHead = state.snake[0];
    let nextX = currentHead.x + vector.x;
    let nextY = currentHead.y + vector.y;

    // Verificação de limites do Grid
    if (state.wallMode === 'wrap') {
      nextX = (nextX + state.gridSize) % state.gridSize;
      nextY = (nextY + state.gridSize) % state.gridSize;
    } else if (nextX < 0 || nextX >= state.gridSize || nextY < 0 || nextY >= state.gridSize) {
      state.status = 'gameover';
      state.cause = 'wall';
      events.push('collision:wall');
      return { state, events };
    }

    const nextHead = { x: nextX, y: nextY };
    const willEatFood = isSameCell(nextHead, state.food);
    const willEatBonus = Boolean(state.bonusFood && isSameCell(nextHead, state.bonusFood));
    const willGrow = willEatFood || willEatBonus;

    // Se não crescer, a última célula da cauda ficará livre neste mesmo tick
    const bodyToCheck = willGrow ? state.snake : state.snake.slice(0, -1);
    const hitSelf = bodyToCheck.some((segment) => isSameCell(segment, nextHead));

    if (hitSelf) {
      state.status = 'gameover';
      state.cause = 'self';
      events.push('collision:self');
      return { state, events };
    }

    // Move a cobra no grid
    state.snake.unshift(nextHead);
    if (!willGrow) {
      state.snake.pop();
    }

    state.ticks += 1;

    const multiplier = (SPEED_PRESETS[state.speed] || SPEED_PRESETS.normal).scoreMultiplier;

    // Atualiza bônus temporário existente
    if (state.bonusFood && !willEatBonus) {
      state.bonusFood.ticksLeft -= 1;
      if (state.bonusFood.ticksLeft <= 0) {
        state.bonusFood = null;
        events.push('bonus:expired');
      }
    }

    if (willEatBonus) {
      const bonusPoints = Math.round(30 * multiplier);
      state.score += bonusPoints;
      state.bonusEaten += 1;
      state.bonusFood = null;
      events.push('eat:bonus');
    }

    if (willEatFood) {
      const applePoints = Math.round(10 * multiplier);
      state.score += applePoints;
      state.apples += 1;
      state.tickMs = computeTickMs(state.speed, state.apples);
      events.push('eat:food');

      // Verifica se preencheu todo o Grid (Vitória máxima)
      if (state.snake.length >= state.gridSize * state.gridSize) {
        state.food = null;
        state.bonusFood = null;
        state.status = 'won';
        state.cause = 'won';
        state.score += Math.round(100 * multiplier);
        events.push('game:won');
        return { state, events };
      }

      const occupied = [...state.snake];
      if (state.bonusFood) occupied.push(state.bonusFood);
      state.food = spawnRandomCell(state.gridSize, occupied, rng);

      // A cada 5 maçãs comidas, gera uma fruta dourada bônus no Grid
      if (state.apples > 0 && state.apples % 5 === 0 && !state.bonusFood) {
        const occupiedForBonus = [...state.snake];
        if (state.food) occupiedForBonus.push(state.food);
        const bonusCell = spawnRandomCell(state.gridSize, occupiedForBonus, rng);
        if (bonusCell) {
          const maxTicks = Math.max(24, Math.round(state.gridSize * 1.6));
          state.bonusFood = {
            x: bonusCell.x,
            y: bonusCell.y,
            ticksLeft: maxTicks,
            maxTicks,
          };
          events.push('bonus:spawned');
        }
      }
    }

    return { state, events };
  }

  function buildGridMatrix(state) {
    const matrix = Array.from({ length: state.gridSize }, () =>
      Array.from({ length: state.gridSize }, () => 'empty')
    );

    if (state.food) {
      matrix[state.food.y][state.food.x] = 'food';
    }
    if (state.bonusFood) {
      matrix[state.bonusFood.y][state.bonusFood.x] = 'bonus';
    }

    for (let i = state.snake.length - 1; i >= 0; i -= 1) {
      const seg = state.snake[i];
      if (seg.x >= 0 && seg.x < state.gridSize && seg.y >= 0 && seg.y < state.gridSize) {
        if (i === 0) {
          matrix[seg.y][seg.x] = 'head';
        } else if (i === state.snake.length - 1) {
          matrix[seg.y][seg.x] = 'tail';
        } else {
          matrix[seg.y][seg.x] = 'body';
        }
      }
    }

    return matrix;
  }

  function formatCauseLabel(cause) {
    switch (cause) {
      case 'wall':
        return 'Colisão na parede';
      case 'self':
        return 'Mordeu a própria cauda';
      case 'won':
        return 'Grid completo (Vitória!)';
      case 'quit':
        return 'Partida encerrada';
      default:
        return 'Fim de jogo';
    }
  }

  return {
    DIRECTIONS,
    OPPOSITE,
    SPEED_PRESETS,
    clampGridSize,
    createGameState,
    queueDirection,
    stepGame,
    buildGridMatrix,
    computeTickMs,
    formatCauseLabel,
  };
});
