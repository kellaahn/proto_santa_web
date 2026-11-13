(() => {
  'use strict';

  /* ============================================================
   *  기본 설정
   *  - 글자는 대문자 P R O T O 만 사용 (모노스페이스 → 모든 칸 폭 동일)
   *  - 화면 전체가 하나의 격자. 모든 글자는 칸 안에만, 한 칸에 한 글자.
   *  - 칸 크기는 화면 크기에 맞춰 정해짐 → 큰 화면일수록 칸 수가 늘어 트리가 더 세밀해짐
   *  - 아스키 명암 표현을 P R O T O 의 잉크 양 + 굵기 + 밝기로 대체
   *      어두움(저밀도)  T T P R   / 400
   *      중간            P R T O   / 600
   *      밝음(고밀도)    O R O P   / 800
   * ============================================================ */
  const LETTERS = ['P', 'R', 'O', 'T', 'O'];
  const pick = (r = Math.random) => LETTERS[(r() * LETTERS.length) | 0];
  const RAMP = [['T', 'T', 'P', 'R'], ['P', 'R', 'T', 'O'], ['O', 'R', 'O', 'P']];
  const WEIGHTS = [400, 600, 800];
  const bucketOf = b => (b < 0.34 ? 0 : b < 0.62 ? 1 : 2);

  // 화면 세로에 들어갈 칸(행) 수의 기준 — 크면 글자가 작아지고 트리가 세밀해짐
  const ROWS_PER_SCREEN = 105;
  const CELL_MIN_PX = 7, CELL_MAX_PX = 18;   // 칸 높이 (px) 범위

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function h2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const RATIO = 1.5;                       // 칸 세로/가로
  const TAU = Math.PI * 2;
  const WIDTH_K = 0.655;                   // 바닥 반지름 = 트리 높이 x 0.655

  const GR_OPTIONS = [14, 10, 8];
  const INPUT_ROWS = GR_OPTIONS[0] + 4;
  const SIDE_MIN_COLS = 40;                // 옆 패널 최소 폭

  const C = {
    white:   [255, 255, 255],
    forest:  [6, 95, 70],
    emerald: [16, 185, 129],
    neon:    [0, 255, 65],
    lime:    [150, 255, 90],
    gold:    [255, 215, 0],
    orange:  [255, 140, 0],
    red:     [255, 42, 42],
    pink:    [255, 90, 140],
    amber:   [255, 165, 0],
    blue:    [59, 130, 246],
    purple:  [168, 85, 247],
    silver:  [215, 225, 240],
  };

  // 진행도 P 단계
  const S = {
    BUILD: [0.00, 0.40],   // 흰 글자로 아래부터 쌓임
    G_LOW: [0.40, 0.56],   // 초록 아래 절반
    G_UP:  [0.56, 0.72],   // 초록 위 절반
    YEL:   [0.72, 0.82],   // 노란 가랜드 + 금빛 반짝이
    RED:   [0.82, 0.92],   // 볼·전구 + 색 반짝이
    GIFT:  [0.92, 0.975],  // 선물 상자
  };
  const P_END = 1.04;
  const BLEND = 0.02;

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerpIn = (range, k) => range[0] + (range[1] - range[0]) * k;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const scale = (a, k) => [Math.min(255, a[0] * k), Math.min(255, a[1] * k), Math.min(255, a[2] * k)];
  const frac = v => v - Math.floor(v);
  const rgb = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  // 조명 / 카메라 (살짝 위에서 내려다봄)
  const norm3 = v => { const m = Math.hypot(...v); return v.map(x => x / m); };
  const LIGHT = norm3([-0.6, 0.55, 0.58]);
  const TILT = 0.2, COS_T = Math.cos(TILT), SIN_T = Math.sin(TILT);
  const VIEW = [0, SIN_T, COS_T];
  const HALF = norm3(LIGHT.map((x, i) => x + VIEW[i]));

  const SPARK_EARLY = [C.gold, C.gold, C.white, C.amber];
  const SPARK_LATE = [C.red, C.orange, C.blue, C.purple, C.pink, C.white];
  const BALL_COLORS = [C.red, C.red, C.red, C.red, C.gold, C.blue, C.purple, C.silver];
  const BULB_COLORS = [C.amber, C.white, C.pink, C.blue, C.red, C.gold];

  // 선물 상자 (3D 직육면체) — K=1 기준. x,z 위치 / w,d,h 크기 / yaw 회전
  const GIFTS = [
    { x: -37, z: 12, w: 15, d: 11, h: 13, yaw: 0.45,  body: C.gold,   rib: C.red },
    { x: 37,  z: 10, w: 16, d: 12, h: 14, yaw: -0.5,  body: C.red,    rib: C.gold },
    { x: -8,  z: 30, w: 10, d: 9,  h: 9,  yaw: 0.3,   body: C.blue,   rib: C.white },
    { x: 9,   z: 33, w: 9,  d: 8,  h: 7,  yaw: -0.35, body: C.purple, rib: C.gold },
    { x: -23, z: 27, w: 9,  d: 8,  h: 7,  yaw: 0.6,   body: C.red,    rib: C.white },
  ];
  const GIFT_ROWS = 13;                    // 트리 아래 선물 상자 공간 (K=1 기준 행)

  /* ============================================================
   *  트리 기하 — 화면 크기에 따라 다시 만듦
   *  (기준 설계 79행일 때 K = 1. 행 수가 늘면 K 비율로 모두 커짐)
   *  잎만 있는 트리 + 아래 선물 상자 (밑동·바닥 띠 없음)
   * ============================================================ */
  let K = 1, COLS = 0, ROWS = 0, CX = 0;
  let TREE_TOP = 0, TREE_BOT = 0, TREE_SPAN = 1, BASE_R = 1, MID_ROW = 0;
  let STAR_RO = 5.4, STAR_RI = 2.3, STAR_T = 1.8, STAR_CY = 0, FLOOR = 0, TREE_SHIFT = 0;
  let U_Q = 180;
  let NCELL = 0;
  let ZB, ZS, ZK, OD, OCOL, OB, OA, GD, GCOL, GB, GAP;
  let lights = [];
  let builtRows = -1;
  const starBound = new Float32Array(720);

  function geomFor(rows) {
    const k = rows / 79;
    const top = Math.round(7 * k);
    const span = rows - 1 - top - GIFT_ROWS * k;                       // 아래는 선물 상자 공간
    const baseR = WIDTH_K * span;
    const cols = 2 * Math.ceil(baseR) + 5;
    return { k, top, span, baseR, cols };
  }

  const radiusAt = yN => {
    const base = 0.6 * K + (BASE_R - 0.6 * K) * yN;
    const f = frac(yN * 6 * 0.999);
    return base * (0.6 + 0.4 * Math.pow(f, 0.7));
  };
  const bottomUp = r => clamp01((TREE_BOT - r) / (TREE_BOT - TREE_TOP)); // 0 = 맨 아래, 1 = 꼭대기

  // 월드 좌표 → [화면 행, 화면 열, 깊이(클수록 앞)]  (x,z: 칸 폭 단위, y: 행)
  let projShift = 0;                       // 트리·별·볼만 아래로 내리는 양 (선물은 0)
  function project(x, y, z) {
    return [
      TREE_TOP + projShift + ((y - TREE_TOP) * RATIO * COS_T + z * SIN_T) / RATIO,
      CX + x,
      z * COS_T - y * RATIO * SIN_T,
    ];
  }

  function buildGeometry(rows) {
    if (rows === builtRows) return;
    builtRows = rows;
    const g = geomFor(rows);
    K = g.k; ROWS = rows; COLS = g.cols; CX = (COLS - 1) / 2;
    TREE_TOP = g.top; TREE_SPAN = g.span; TREE_BOT = TREE_TOP + TREE_SPAN; BASE_R = g.baseR;
    MID_ROW = TREE_TOP + TREE_SPAN / 2;
    STAR_RO = 5.4 * K; STAR_RI = 2.3 * K; STAR_T = 1.8 * K;
    STAR_CY = TREE_TOP - 2.9 * K;
    FLOOR = TREE_BOT + 7 * K;
    TREE_SHIFT = Math.round(6 * K);          // 트리를 지금 모양 그대로 아래로 (3K씩 두 번)
    projShift = TREE_SHIFT;
    U_Q = Math.round(180 * K);
    NCELL = COLS * ROWS;

    // 3D 래스터: 원뿔 표면을 촘촘히 찍어 칸마다 가장 앞 점만 남김 (z-버퍼)
    ZB = new Float32Array(NCELL).fill(-1e9);
    ZS = new Float32Array(NCELL * 3);
    ZK = new Uint8Array(NCELL);
    const put = (y, x, z) => {
      const [r, c, d] = project(x, y, z);
      const sr = Math.round(r), cc = Math.round(c);
      if (sr < 0 || sr >= ROWS || cc < 0 || cc >= COLS) return;
      const i = sr * COLS + cc;
      if (d <= ZB[i]) return;
      ZB[i] = d; ZS[i * 3] = y; ZS[i * 3 + 1] = x; ZS[i * 3 + 2] = z; ZK[i] = 1;
    };
    for (let y = TREE_TOP; y <= TREE_BOT + 1e-6; y += 0.25) {
      const r = radiusAt((y - TREE_TOP) / TREE_SPAN);
      for (let x = Math.ceil(-r); x <= Math.floor(r); x++) {
        const z = Math.sqrt(Math.max(0, r * r - x * x));
        put(y, x, z);
        if (z > 0.5) put(y, x, -z);                        // 위에서 보이는 뒷면 가장자리
      }
    }

    OD = new Float32Array(NCELL);
    OCOL = new Float32Array(NCELL * 3);
    OB = new Float32Array(NCELL);
    OA = new Float32Array(NCELL);

    // 볼(큰 구) + 전구(작은 구) — 화면이 커지면 개수도 늘림
    const rng = mulberry32(1225);
    const nBig = Math.round(70 * K * K), nBulb = Math.round(170 * K * K);
    lights = Array.from({ length: nBig + nBulb }, (_, i) => {
      const big = i < nBig;
      const yN = 0.07 + Math.sqrt(rng()) * 0.91;
      const row = TREE_TOP + yN * TREE_SPAN;
      const pal = big ? BALL_COLORS : BULB_COLORS;
      return {
        big, yN, row, u: rng(),
        rad: big ? (1.35 + rng() * 0.45) * K : Math.max(0.55, 0.55 * K),
        col: pal[(rng() * pal.length) | 0],
        at: lerpIn(S.RED, clamp01(bottomUp(row) * 0.88 + rng() * 0.12)),
        ph: rng() * TAU, sp: 2 + rng() * 3,
      };
    });

    // 선물 상자: 움직이지 않으므로 여기서 한 번만 래스터
    GD = new Float32Array(NCELL).fill(-1e9);
    GCOL = new Float32Array(NCELL * 3);
    GB = new Float32Array(NCELL);
    GAP = new Float32Array(NCELL).fill(9);
    rasterGifts();

    // 별 외곽 반지름 표
    const vs = [];
    for (let k = 0; k < 10; k++) {
      const a = Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 ? STAR_RI : STAR_RO;
      vs.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * TAU, dx = Math.cos(a), dy = Math.sin(a);
      let best = STAR_RO;
      for (let e = 0; e < 10; e++) {
        const [x1, y1] = vs[e], [x2, y2] = vs[(e + 1) % 10];
        const ex = x2 - x1, ey = y2 - y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = (x1 * ey - y1 * ex) / den;
        const ss = (x1 * dy - y1 * dx) / den;
        if (tt > 0 && ss >= -1e-6 && ss <= 1 + 1e-6) best = Math.min(best, tt);
      }
      starBound[k] = best;
    }
  }

  function greenShade(b) {
    if (b < 0.45) return mix(C.forest, C.emerald, b / 0.45);
    if (b < 0.85) return mix(C.emerald, C.neon, (b - 0.45) / 0.4);
    return mix(C.neon, C.lime, (b - 0.85) / 0.15);
  }
  function greenAt(row, h) {
    if (row >= MID_ROW) return lerpIn(S.G_LOW, clamp01(((TREE_BOT - row) / (TREE_BOT - MID_ROW)) * 0.88 + h * 0.12));
    return lerpIn(S.G_UP, clamp01(((MID_ROW - row) / (MID_ROW - TREE_TOP)) * 0.88 + h * 0.12));
  }

  /* ============================================================
   *  상태
   * ============================================================ */
  let total = 0, count = 0, letterCount = 0;
  let P = 0, tween = null, finaleStart = null, doneShown = false, started = false;
  let rot = 0;
  const ROT_SPEED = 0.38; // rad/s
  const F = { BACK: 1.7, STAR: 3.3, Y1: 4.0, W2: 4.55, Y2: 5.1, END: 5.8 };

  // 완성 후 타이틀: 한 줄씩 순서대로, 각 줄이 화면 폭을 꽉 채움 (트리 뒤에 깔림)
  const TITLE = ['PROTO', 'MERRY', 'CHRISTMAS'];
  const T0 = F.END + 0.4;
  const T_GAP = 1.3;
  const T_SWEEP = 0.8;
  const T_DONE = T0 + (TITLE.length - 1) * T_GAP + T_SWEEP + 0.6;
  // 진짜 마지막: 따뜻한 금빛 조명이 아래부터 켜짐 (사진 같은 점등 장면)
  const LIT_T = T_DONE + 0.6;
  const WARM = [255, 228, 160], WARM_WHITE = [255, 242, 205];
  const LIT_BALLS = [[236, 178, 48], [250, 205, 95], [214, 214, 220], [196, 158, 70], [240, 225, 190]];
  const TITLE_LIT_T = LIT_T + 1.5;      // 나무 점등(약 3초)의 중간쯤부터 글자도 점등
  let curFt = -1;
  const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const litAll = () => (curFt < 0 ? 0 : smooth((curFt - LIT_T) / 3));                       // 전체 점등 정도
  const litRow = row => (curFt < 0 ? 0 : smooth((curFt - LIT_T - bottomUp(row) * 1.6) / 0.9)); // 아래부터 켜짐
  function litFoliage(b) {                                                                    // 조명 받은 잎: 올리브 → 금빛 연두
    if (b < 0.5) return mix([30, 48, 14], [118, 140, 36], b / 0.5);
    return mix([118, 140, 36], [236, 226, 120], (b - 0.5) / 0.5);
  }

  /* ============================================================
   *  캔버스 / 전역 격자 / 레이아웃
   * ============================================================ */
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const $ = id => document.getElementById(id);
  const nameInput = $('name'), sendBtn = $('send'), hint = $('hint');
  const hud = $('hud'), hudMembers = $('hud-members'), hudLetters = $('hud-letters');
  const hudRot = $('hud-rot'), hudLights = $('hud-lights');
  const setup = $('setup'), countInput = $('count'), startBtn = $('start'), restartBtn = $('restart');

  let W = 0, H = 0, dpr = 1;
  let cw = 6, ch = 9;
  let GC = 0, GRW = 0, gx = 0, gy = 0;
  let treeC0 = 0, treeR0 = 0;
  let side = false;
  let panel = { c0: 0, c1: 0, r0: 0, r1: 0 };
  let occ = new Uint8Array(0);
  let FONTS = [];

  const cx = col => gx + (col + 0.5) * cw;
  const cy = row => gy + (row + 0.5) * ch;

  function layout() {
    W = innerWidth; H = innerHeight;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);

    // 칸 크기: 화면에 맞춰 자동 조정 (큰 화면 → 칸 수 증가 → 더 세밀)
    ch = Math.max(CELL_MIN_PX, Math.min(CELL_MAX_PX, Math.min(H, W * 1.3) / ROWS_PER_SCREEN));
    cw = ch / RATIO;
    FONTS = WEIGHTS.map(w => `${w} ${ch * 0.92}px ${MONO}`);

    GC = Math.floor(W / cw);
    GRW = Math.floor(H / ch);
    gx = (W - GC * cw) / 2;
    gy = (H - GRW * ch) / 2;
    occ = new Uint8Array(GC * GRW);

    const topRows = 1, bottomRows = 1;
    let rows = GRW - topRows - bottomRows;
    side = true;
    if (geomFor(rows).cols + SIDE_MIN_COLS + 3 > GC) {
      let r2 = rows;
      while (r2 > 20 && geomFor(r2).cols + SIDE_MIN_COLS + 3 > GC) r2--;
      if (r2 >= rows * 0.8) rows = r2;
      else {
        // 세로 화면: 트리는 폭에 꽉, 입력은 아래
        side = false;
        rows = rows - INPUT_ROWS - 2;
        while (rows > 20 && geomFor(rows).cols + 2 > GC) rows--;
      }
    }
    buildGeometry(rows);

    if (side) {
      treeC0 = Math.floor((GC - COLS) / 2);
      if (GC - (treeC0 + COLS) - 2 < SIDE_MIN_COLS) treeC0 = Math.max(0, GC - COLS - SIDE_MIN_COLS - 2);
      treeR0 = topRows + Math.max(0, Math.floor((GRW - topRows - bottomRows - ROWS) / 2));
      const panelCols = Math.min(72, GC - (treeC0 + COLS) - 3);
      panel = { c0: treeC0 + COLS + 1, c1: Math.min(GC - 2, treeC0 + COLS + panelCols), r0: treeR0 + 4, r1: treeR0 + ROWS - 6 };
    } else {
      treeC0 = Math.floor((GC - COLS) / 2);
      treeR0 = topRows;
      const pr0 = treeR0 + ROWS + 1;
      panel = { c0: 1, c1: GC - 2, r0: pr0, r1: Math.max(pr0 + INPUT_ROWS - 1, GRW - Math.ceil(60 / ch)) };
    }

    const px0 = gx + panel.c0 * cw, px1 = gx + (panel.c1 + 1) * cw;
    const py0 = gy + panel.r0 * ch, py1 = gy + (panel.r1 + 1) * ch;
    Object.assign(nameInput.style, { left: px0 + 'px', top: py0 + 'px', width: (px1 - px0) + 'px', height: (py1 - py0) + 'px' });
    if (side) {
      Object.assign(sendBtn.style, { right: Math.max(16, W - px1) + 'px', bottom: Math.max(16, H - py1 - 8) + 'px' });
      Object.assign(hint.style, { left: px0 + 'px', bottom: Math.max(24, H - py1) + 'px' });
    } else {
      Object.assign(sendBtn.style, { right: '16px', bottom: '16px' });
      Object.assign(hint.style, { left: '16px', bottom: '24px' });
    }

    // 지면: 화면 아래 1/3 (지평선 = 화면 2/3 지점)
    const oldH = horizon, oldGC = floorGC, oldSnow = snowAmt;
    horizon = Math.floor(GRW * 2 / 3);
    floorGC = GC;
    snowAmt = new Float32Array(GC * (GRW - horizon));
    if (oldSnow.length) {                               // 창 크기가 바뀌어도 쌓인 눈 유지
      const oldRows = oldSnow.length / oldGC, newRows = GRW - horizon;
      for (let r = 0; r < newRows; r++) {
        const orr = Math.min(oldRows - 1, Math.floor(r * oldRows / newRows));
        for (let c = 0; c < GC; c++) snowAmt[r * GC + c] = oldSnow[orr * oldGC + Math.floor(c * oldGC / GC)];
      }
    }
    void oldH;
    initSnow();
    initStars();
    titleDirty = true;
    if (started) refreshGlyph();
  }

  function claim(col, row, v) {
    if (col < 0 || row < 0 || col >= GC || row >= GRW) return false;
    const i = row * GC + col;
    if (occ[i]) return false;
    occ[i] = v;
    return true;
  }
  const claimed = (col, row) => col < 0 || row < 0 || col >= GC || row >= GRW || occ[row * GC + col] !== 0;

  // 굵기별로 모아서 그리기 (x, y, ch, fill, alpha)
  const batches = [[], [], []];
  function emit(col, row, chr, color, alpha, bucket) {
    if (!claim(col, row, 1)) return false;
    batches[bucket].push(cx(col), cy(row), chr, typeof color === 'string' ? color : rgb(color), alpha);
    return true;
  }
  function flush(c) {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let b = 0; b < 3; b++) {
      const arr = batches[b];
      if (!arr.length) continue;
      c.font = FONTS[b];
      for (let i = 0; i < arr.length; i += 5) {
        c.globalAlpha = arr[i + 4];
        c.fillStyle = arr[i + 3];
        c.fillText(arr[i + 2], arr[i], arr[i + 1]);
      }
      arr.length = 0;
    }
    c.globalAlpha = 1;
  }

  /* ============================================================
   *  배경: 떨어지는 눈 + 반짝이는 별 + 원근 지면(쌓이는 눈)
   *  눈송이마다 깊이 d (0 = 멀리, 1 = 가까이)
   *   - 멀수록 흐리고 가늘고 느리게, 지평선 근처에 내려앉음
   *   - 가까울수록 밝고 굵고 빠르게, 화면 아래쪽에 내려앉음
   * ============================================================ */
  let horizon = 0, floorGC = 0;
  let snowAmt = new Float32Array(0);         // 지면 칸마다 쌓인 눈 (0 ~ 1)
  const SNOW_ADD = 0.45;                     // 눈송이 하나가 덮는 양

  let flakes = [];
  function makeFlake(init) {
    const d = Math.random();
    const floorRows = GRW - horizon;
    const land = horizon + 1 + Math.pow(d, 0.8) * (floorRows - 2) + (Math.random() - 0.5) * 2;
    return {
      d, land,
      col: (Math.random() * GC) | 0,
      row: init ? Math.random() * land : -1 - Math.random() * 12,
      speed: (3 + 6 * d) * (0.8 + Math.random() * 0.4) * (GRW / 80),
      lastRow: -999,
      ch: pick(),
      a: 0.22 + 0.7 * d,
      w: d > 0.7 ? 2 : d > 0.35 ? 1 : 0,
    };
  }
  let baseFlakes = 0;
  function initSnow() {
    const n = Math.round(Math.max(50, Math.min(900, GC * GRW * 0.02)));
    baseFlakes = n;
    flakes = Array.from({ length: n }, () => makeFlake(true));
  }

  // 내려앉은 자리 주변을 덮음 (가까울수록 넓게)
  function landFlake(f) {
    const fr = Math.round(f.land) - horizon;
    const floorRows = GRW - horizon;
    const rad = 1 + f.d * 3.5;
    const rr = f.d > 0.6 ? 1 : 0;
    for (let dy = -rr; dy <= rr; dy++) {
      const r = fr + dy;
      if (r < 0 || r >= floorRows) continue;
      for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
        const c = f.col + dx;
        if (c < 0 || c >= GC) continue;
        const k = 1 - Math.hypot(dx / rad, dy * 0.8);
        if (k <= 0) continue;
        const i = r * GC + c;
        snowAmt[i] = Math.min(1, snowAmt[i] + SNOW_ADD * k * (0.6 + Math.random() * 0.8));
      }
    }
  }

  function updateSnow(dt) {
    const want = Math.round(baseFlakes * (1 + 0.9 * litAll()));      // 점등 후 눈 더 많이
    for (let k = 0; k < 6 && flakes.length < want; k++) flakes.push(makeFlake(false));
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      f.row += f.speed * dt;
      const r = Math.floor(f.row);
      if (r !== f.lastRow) {
        if (f.lastRow !== -999 && Math.random() < 0.18) f.col += Math.random() < 0.5 ? -1 : 1;
        if (f.col < 0) f.col = GC - 1;
        if (f.col >= GC) f.col = 0;
        f.lastRow = r;
      }
      if (f.row >= f.land) {
        landFlake(f);
        flakes[i] = makeFlake(false);
      }
    }
  }

  // 공중 반짝이: 트리 주변에 떠서 빠르게 깜빡이는 금빛 점 (점등 후)
  function drawAirSparkles(t) {
    const lk = litAll();
    if (lk <= 0) return;
    const n = Math.round(GC * GRW * 0.025);
    const tcx = treeC0 + CX, tcy = treeR0 + TREE_SHIFT + TREE_TOP + TREE_SPAN * 0.5;
    for (let i = 0; i < n; i++) {
      const a = h2(i, 77) * TAU, rr = Math.sqrt(h2(i, 78));
      const drift = (t * (0.4 + h2(i, 81) * 0.8) + h2(i, 82) * 50) % 1;       // 천천히 아래로 흐름
      const col = Math.round(tcx + Math.cos(a) * rr * BASE_R * 1.6);
      const row = Math.round(tcy + Math.sin(a) * rr * TREE_SPAN * 0.75 + drift * 6 * K);
      if (row >= horizon) continue;
      const tw = Math.pow(Math.max(0, Math.sin(t * (2 + h2(i, 79) * 6) + h2(i, 80) * 100)), 6);
      if (tw < 0.08) continue;
      if (!claim(col, row, 7)) continue;
      const near = 1 - rr * 0.6;
      const c = mix(WARM, C.white, h2(i, 83));
      batches[tw > 0.6 ? 2 : 1].push(cx(col), cy(row), LETTERS[(h2(i, 84) * 5) | 0], rgb(scale(c, 0.6 + 0.5 * tw)), Math.min(1, tw * near * lk * 1.2));
    }
  }

  function drawFlakes() {
    for (const f of flakes) {
      const r = Math.floor(f.row);
      if (!claim(f.col, r, 2)) continue;
      let fill = '#fff';
      const lk = litAll();
      if (lk > 0) {                                                  // 트리 가까운 눈은 금빛으로
        const dx = (f.col - (treeC0 + CX)) / (BASE_R * 1.3), dy = (r - (treeR0 + TREE_SHIFT + TREE_TOP + TREE_SPAN * 0.5)) / (TREE_SPAN * 0.8);
        const near = clamp01(1 - Math.hypot(dx, dy)) * lk;
        if (near > 0) fill = rgb(mix(C.white, WARM, near));
      }
      batches[f.w].push(cx(f.col), cy(r), f.ch, fill, f.a);
    }
  }

  // 원근 지면: 아래(가까운 쪽)일수록 밝고 굵게, 지평선 쪽은 어둡고 성기게.
  // 지평선 한 점으로 모이는 세로 줄 + 아래로 갈수록 넓어지는 가로 줄 → 바닥 타일 원근.
  // 눈이 쌓이면 줄이 묻히고 하얀 설원이 됨.
  const GROUND = [34, 42, 60], SNOW_NEAR = [255, 255, 255], SNOW_FAR = [150, 165, 195];
  // 바닥 그림자: 트리·선물 밑동에서 오른쪽 뒤(빛 반대쪽)로 깔리는 부드러운 타원
  function buildShadows() {
    const list = [];
    // 트리: 쌓이는 만큼 진해짐
    const treeK = smooth(P / S.BUILD[1]);
    if (treeK > 0) {
      const [r, c] = project(BASE_R * 0.35, TREE_BOT, -BASE_R * 0.25);
      list.push({ c: treeC0 + c, r: treeR0 + r, rx: BASE_R * 1.45, ry: BASE_R * 0.42 / RATIO, k: 0.7 * treeK });
    }
    // 선물 상자: 생길 때 같이
    const keep = projShift;
    projShift = 0;
    GIFTS.forEach((g, gi) => {
      const k = clamp01((P - lerpIn(S.GIFT, gi * 0.1)) / 0.02);
      if (k <= 0) return;
      const w = g.w * K, d = g.d * K;
      const [r, c] = project(g.x * K + w * 0.45, FLOOR, g.z * K - d * 0.35);
      list.push({ c: treeC0 + c, r: treeR0 + r, rx: w * 0.95, ry: Math.max(1.2, d * 0.55 / RATIO), k: 0.75 * k });
    });
    projShift = keep;
    return list;
  }
  function shadowAt(list, c, r) {
    let sh = 0;
    for (const s of list) {
      const d = Math.hypot((c - s.c) / s.rx, (r - s.r) / s.ry);
      if (d < 1) sh = Math.max(sh, s.k * (1 - smooth((d - 0.45) / 0.55)));
    }
    return sh;
  }

  function drawFloor(t) {
    const floorRows = GRW - horizon;
    const vpx = GC / 2;
    const shadows = buildShadows();
    for (let fr = 0; fr < floorRows; fr++) {
      const row = horizon + fr;
      const dT = (fr + 1) / floorRows;                  // 0 지평선 → 1 화면 아래
      const dz = fr + 1;                                 // 지평선에서 떨어진 행 수
      const zw = 60 / dz;                                // 월드 깊이 (1/거리)
      const zLine = Math.abs(zw / 5 - Math.round(zw / 5)) * 5 / (60 / (dz * dz));   // 가로 줄까지 행 거리
      const base = 0.1 + 0.6 * Math.pow(dT, 1.3);        // 아래일수록 밝게
      const dens = 0.35 + 0.6 * dT;
      for (let c = 0; c < GC; c++) {
        const i = fr * GC + c;
        const a = snowAmt[i];
        const h = h2(c * 13 + 7, row);
        const u = (c - vpx) / dz;
        const xLine = Math.abs(u / 2.4 - Math.round(u / 2.4)) * 2.4 * dz;          // 세로 줄까지 열 거리
        const onLine = (xLine < 0.55 || zLine < 0.5) && dT > 0.08;
        if (a < 0.12 && !onLine && h > dens) continue;
        if (!claim(c, row, 4)) continue;

        let col = scale(GROUND, (0.35 + 3.2 * base) * (onLine ? 1.35 : 1));      // 아래 밝고 지평선 쪽 어둡게
        let b = base * (onLine ? 1.4 : 1);
        if (a > 0) {
          const snow = scale(mix(SNOW_FAR, SNOW_NEAR, dT), 0.45 + 0.55 * dT);
          const k = Math.min(1, a * 1.15);
          col = mix(col, snow, k);
          b = b + (0.35 + 0.5 * dT - b) * k;
          if (a > 0.85 && h < 0.04) {                    // 눈 표면 반짝임
            const glint = 0.5 + 0.5 * Math.sin(t * (2 + h * 60) + c);
            col = mix(col, C.white, glint * 0.8);
          }
        }
        // 그림자: 바닥은 어둡게, 눈 위에서는 푸르스름한 그늘
        const sh = shadows.length ? shadowAt(shadows, c, row) : 0;
        if (sh > 0) {
          col = mix(col, scale(mix([20, 26, 42], [70, 88, 130], Math.min(1, a)), 0.6 + 0.4 * dT), sh);
          b *= 1 - sh * 0.7;
        }
        const bk = bucketOf(clamp01(b + dT * 0.25));
        batches[bk].push(cx(c), cy(row), RAMP[bk][(h2(c, row * 3) * 4) | 0], rgb(col), 0.5 + 0.5 * Math.max(dT, a));
      }
    }
  }

  let stars = [];
  function initStars() {
    const n = Math.round(GC * GRW * 0.03);
    stars = Array.from({ length: n }, () => ({
      col: (Math.random() * GC) | 0,
      row: (Math.random() * GRW) | 0,
      ch: pick(),
      v: Math.random() < 0.8 ? 0.1 + Math.random() * 0.35 : 0.5 + Math.random() * 0.5,
      w: Math.random() < 0.15 ? 2 : 0,
      ph: Math.random() * TAU,
      sp: 0.5 + Math.random() * 2.5,
    }));
  }
  function drawBackground(t) {
    for (const s of stars) {
      if (s.row >= horizon) continue;                  // 별은 하늘에만
      if (!claim(s.col, s.row, 3)) continue;
      const tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.ph);
      const v = Math.round(51 + 204 * s.v);
      batches[s.w].push(cx(s.col), cy(s.row), s.ch, `rgb(${v},${v},${v})`, 0.25 + 0.6 * tw * s.v);
    }
  }

  /* ============================================================
   *  이름 → P R O T O 글자 (획 두께 약 2칸), 패널 폭 넘으면 줄바꿈
   * ============================================================ */
  const SX = 8, SY = SX * RATIO;
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });
  let glyph = { lines: [], gr: GR_OPTIONS[0] };
  const hashLetter = (c, r) => LETTERS[(((c * 73856093) ^ (r * 19349663)) >>> 0) % LETTERS.length];
  const glyphFont = gr => `900 ${Math.round(SY * gr * 0.84)}px ${KR}`;

  function sampleText(str, gr) {
    if (!str) return { cols: 0, cells: [] };
    const font = glyphFont(gr);
    const fontPx = Math.round(SY * gr * 0.84);
    octx.font = font;
    const w = Math.ceil(octx.measureText(str).width) + SX * 4;
    const cols = Math.ceil(w / SX);
    off.width = cols * SX;
    off.height = Math.ceil(gr * SY);
    octx.font = font;
    octx.fillStyle = '#fff';
    octx.textBaseline = 'middle';
    octx.textAlign = 'left';
    octx.fillText(str, SX * 2, off.height / 2 + fontPx * 0.03);
    const data = octx.getImageData(0, 0, off.width, off.height).data;

    const out = [];
    let minC = Infinity, maxC = -Infinity;
    for (let r = 0; r < gr; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * SX), y0 = Math.floor(r * SY);
        const x1 = Math.floor((c + 1) * SX), y1 = Math.floor((r + 1) * SY);
        let sum = 0, n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) { sum += data[(y * off.width + x) * 4 + 3]; n++; }
        }
        if (n && sum / n / 255 > 0.42) {
          out.push({ c, r });
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (!out.length) return { cols: 0, cells: [] };
    for (const p of out) { p.c -= minC; p.ch = hashLetter(p.c, p.r); }
    return { cols: maxC - minC + 1, cells: out };
  }

  function fitGlyph(str) {
    const maxCols = panel.c1 - panel.c0 + 1;
    const maxRows = panel.r1 - panel.r0 + 1;
    let best = null;
    for (const gr of GR_OPTIONS) {
      const lines = [];
      let cur = '';
      for (const chr of [...str]) {
        const test = cur + chr;
        if (cur && sampleText(test, gr).cols + 4 > maxCols) { lines.push(cur); cur = chr; }
        else cur = test;
      }
      if (cur || !lines.length) lines.push(cur);
      const sampled = lines.map(l => sampleText(l, gr));
      best = { lines: sampled, gr };
      if (sampled.every(l => l.cols + 4 <= maxCols) && lines.length * (gr + 2) <= maxRows) return best;
    }
    return best;
  }

  let lastInputAt = 0;
  function refreshGlyph() {
    const v = nameInput.value;
    glyph = fitGlyph(v);
    lastInputAt = performance.now() / 1000;
    if (v && document.fonts && document.fonts.load) {
      document.fonts.load(glyphFont(GR_OPTIONS[0]), v).then(() => {
        if (nameInput.value === v) glyph = fitGlyph(v);
      }).catch(() => {});
    }
  }

  function placeInput(t) {
    const gr = glyph.gr;
    const lines = glyph.lines.length ? glyph.lines : [{ cols: 0, cells: [] }];
    const lineH = gr + 2;
    const blockH = lines.length * lineH - 2;
    const lastCols = lines[lines.length - 1].cols;
    const widest = Math.max(...lines.map(l => l.cols), lastCols + (lastCols ? 2 : 0) + 2);
    const pw = panel.c1 - panel.c0 + 1, ph = panel.r1 - panel.r0 + 1;
    const c0 = panel.c0 + Math.max(0, Math.floor((pw - widest) / 2));
    const r0 = panel.r0 + Math.max(0, Math.floor((ph - blockH) / 2));
    lines.forEach((l, i) => {
      for (const p of l.cells) emit(c0 + p.c, r0 + i * lineH + p.r, p.ch, C.white, 0.96, 2);
    });
    if (((t - lastInputAt) % 1.06) < 0.6) {
      const k0 = c0 + (lastCols ? lastCols + 2 : 0);
      const rr = r0 + (lines.length - 1) * lineH;
      for (let r = 1; r < gr - 1; r++) {
        for (let k = 0; k < 2; k++) emit(k0 + k, rr + r, LETTERS[(r - 1) % LETTERS.length], C.white, 0.96, 2);
      }
    }
  }

  /* ============================================================
   *  3D 물체 (볼·전구·가랜드·별) — 프레임마다 z-버퍼에 찍음
   * ============================================================ */
  const shadeRGB = (col, b, sp) => [
    Math.min(255, col[0] * b + 255 * sp), Math.min(255, col[1] * b + 255 * sp), Math.min(255, col[2] * b + 255 * sp),
  ];
  let oAlpha = 1;
  function oput(c, r, d, rgbv, b) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    const i = r * COLS + c;
    if (d <= OD[i]) return;
    OD[i] = d; OB[i] = b; OA[i] = oAlpha;
    OCOL[i * 3] = rgbv[0]; OCOL[i * 3 + 1] = rgbv[1]; OCOL[i * 3 + 2] = rgbv[2];
  }

  // 구를 칸 단위로 그리기 (칸 중심마다 구 표면 법선으로 음영). write = 어느 버퍼에 쓸지
  function splatSphere(x, y, z, rad, col, spec0, write = oput) {
    const [rc, cc, dc] = project(x, y, z);
    const c0 = Math.floor(cc - rad), c1 = Math.ceil(cc + rad);
    const r0 = Math.floor(rc - rad / RATIO), r1 = Math.ceil(rc + rad / RATIO);
    const cC = Math.round(cc), rC = Math.round(rc);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c - cc, dy = (r - rc) * RATIO;
        let q = rad * rad - dx * dx - dy * dy;
        if (q < 0) { if (r !== rC || c !== cC) continue; q = 0.0001; }
        const dz = Math.sqrt(q);
        const inv = 1 / Math.max(1e-6, Math.hypot(dx, dy, dz));
        const nx = dx * inv, ny = -dy * inv, nz = dz * inv;
        const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const sp = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 16) * spec0;
        const b = 0.12 + 0.88 * diff;
        write(c, r, dc + dz, shadeRGB(col, b, sp), b + sp);
      }
    }
  }

  // 선물 상자: 면마다 다른 조명(윗면 밝고 옆면 어두움) + 모서리 선 + 리본 + 매듭
  function rasterGifts() {
    const keep = projShift;
    projShift = 0;                           // 선물은 제자리
    let curAppear = 0;
    const gwrite = (c, r, d, rgbv, b) => {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
      const i = r * COLS + c;
      if (d <= GD[i]) return;
      GD[i] = d; GB[i] = b; GAP[i] = curAppear;
      GCOL[i * 3] = rgbv[0]; GCOL[i * 3 + 1] = rgbv[1]; GCOL[i * 3 + 2] = rgbv[2];
    };
    GIFTS.forEach((g0, gi) => {
      const g = { ...g0, x: g0.x * K, z: g0.z * K, w: g0.w * K, d: g0.d * K, h: g0.h * K };
      const ca = Math.cos(g.yaw), sa = Math.sin(g.yaw);
      const toW = (lx, ly, lz) => [g.x + lx * ca + lz * sa, FLOOR - ly / RATIO, g.z - lx * sa + lz * ca];
      const rotN = (nx, ny, nz) => [nx * ca + nz * sa, ny, -nx * sa + nz * ca];
      const hw = g.w / 2, hd = g.d / 2, H = g.h;
      const rw = Math.max(0.7, g.w * 0.09);
      const ST = 0.3, EDGE = 0.45;
      const appearAt = ly => lerpIn(S.GIFT, clamp01(gi * 0.1 + (ly / H) * 0.45));
      const face = (n, uMin, uMax, vMin, vMax, toLocal, isRib) => {
        const nw = rotN(...n);
        if (nw[1] * VIEW[1] + nw[2] * VIEW[2] <= 0) return;
        const diff = Math.max(0, nw[0] * LIGHT[0] + nw[1] * LIGHT[1] + nw[2] * LIGHT[2]);
        for (let u = uMin; u <= uMax + 1e-6; u += ST) {
          for (let v = vMin; v <= vMax + 1e-6; v += ST) {
            const [lx, ly, lz] = toLocal(u, v);
            const edge = u - uMin < EDGE || uMax - u < EDGE || v - vMin < EDGE || vMax - v < EDGE;
            const rib = isRib(lx, ly, lz);
            const b = (0.2 + 0.8 * diff) * (edge ? 0.5 : 1) * (rib ? 1.1 : 1);
            const [r, c, d] = project(...toW(lx, ly, lz));
            curAppear = appearAt(ly);
            gwrite(Math.round(c), Math.round(r), d, shadeRGB(rib ? g.rib : g.body, b, 0), b);
          }
        }
      };
      const ribX = lx => Math.abs(lx) < rw;
      const ribZ = (lx, ly, lz) => Math.abs(lz) < rw;
      face([0, 0, 1],  -hw, hw, 0, H, (u, v) => [u, v, hd], ribX);
      face([0, 0, -1], -hw, hw, 0, H, (u, v) => [u, v, -hd], ribX);
      face([1, 0, 0],  -hd, hd, 0, H, (u, v) => [hw, v, u], ribZ);
      face([-1, 0, 0], -hd, hd, 0, H, (u, v) => [-hw, v, u], ribZ);
      face([0, 1, 0],  -hw, hw, -hd, hd, (u, v) => [u, H, v], (lx, ly, lz) => Math.abs(lx) < rw || Math.abs(lz) < rw);
      curAppear = appearAt(H) + 0.01;
      for (const [lx, lz, rad] of [[-rw * 2.2, 0, 1.25 * K], [rw * 2.2, 0, 1.25 * K], [0, 0, 0.85 * K]]) {
        const [X, Y, Z] = toW(lx, H + rad * 0.7, lz);
        splatSphere(X, Y, Z, rad, g.rib, 0.8, gwrite);
      }
    });
    projShift = keep;
  }

  function starZ(lx, ly) {
    const r = Math.hypot(lx, ly);
    const k = ((Math.round((Math.atan2(ly, lx) / TAU) * 720) % 720) + 720) % 720;
    const R = starBound[k];
    return r > R ? -1 : STAR_T * (1 - r / R);
  }

  function splatStar(ft, yellow, t) {
    const st = ft - F.STAR;
    const ang = t * 1.2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const pulse = ft > F.END ? 0.85 + 0.15 * Math.sin(t * 2.4) : 1;
    const E = 0.2 * K, STEP = 0.28;
    for (let ly = -STAR_RO; ly <= STAR_RO; ly += STEP) {
      const delay = ((ly + STAR_RO) / (2 * STAR_RO)) * 0.3;
      if (st < delay) continue;
      oAlpha = clamp01((st - delay) / 0.08);
      for (let lx = -STAR_RO; lx <= STAR_RO; lx += STEP) {
        const z0 = starZ(lx, ly);
        if (z0 < 0) continue;
        const zx1 = starZ(lx + E, ly), zx0 = starZ(lx - E, ly), zy1 = starZ(lx, ly + E), zy0 = starZ(lx, ly - E);
        const fx = zx1 >= 0 && zx0 >= 0 ? (zx1 - zx0) / (2 * E) : 0;
        const fy = zy1 >= 0 && zy0 >= 0 ? (zy1 - zy0) / (2 * E) : 0;
        for (const s of [1, -1]) {
          const lz = z0 * s;
          let nx = -fx, ny = -fy, nz = s;
          const nm = Math.hypot(nx, ny, nz); nx /= nm; ny /= nm; nz /= nm;
          const X = lx * ca + lz * sa, Z = -lx * sa + lz * ca;
          const wx = nx * ca + nz * sa, wz = -nx * sa + nz * ca;
          const [r, c, d] = project(X, STAR_CY - ly / RATIO, Z);
          const diff = Math.max(0, wx * LIGHT[0] + ny * LIGHT[1] + wz * LIGHT[2]);
          const sp = Math.pow(Math.max(0, wx * HALF[0] + ny * HALF[1] + wz * HALF[2]), 14);
          const b = 0.2 + 0.8 * diff;
          const base = mix(yellow ? scale(mix(C.orange, C.gold, b), pulse) : C.white, WARM_WHITE, litAll() * 0.6);
          oput(Math.round(c), Math.round(r), d, shadeRGB(base, 0.3 + 0.8 * b, sp * 0.8), b + sp);
        }
      }
    }
    oAlpha = 1;
  }

  // 가랜드: 트리 바깥을 감고 내려오는 금색 구슬 줄 2가닥
  function splatGarland() {
    const beadR = Math.max(0.6, 0.75 * K);
    for (let strand = 0; strand < 2; strand++) {
      let yN = 0.05, idx = 0;
      while (yN <= 1) {
        const R = radiusAt(yN) + 0.9 * K;
        const row = TREE_TOP + yN * TREE_SPAN;
        const at = lerpIn(S.YEL, clamp01(bottomUp(row) * 0.92 + strand * 0.04));
        const k = clamp01((P - at) / BLEND);
        if (k > 0) {
          const phi = (yN * 4 - 0.37 + strand * 0.5) * TAU - rot;
          const glim = 0.8 + 0.2 * Math.sin(now * 4 + idx * 0.6);
          oAlpha = k;
          splatSphere(R * Math.sin(phi), row, R * Math.cos(phi), beadR, scale(C.gold, glim), 0.9);
        }
        yN += 0.45 / Math.hypot(TAU * Math.max(1, radiusAt(yN)) * 4, TREE_SPAN * RATIO);
        idx++;
      }
    }
    oAlpha = 1;
  }

  let litCount = 0;
  let now = 0;
  // 별 빛살: 별 중심에서 사방으로 뻗는 가는 빛 줄기 (길이가 일렁임)
  function splatStarBurst(t) {
    const L0 = litAll();
    const [rc, cc] = project(0, STAR_CY, 0);
    const N = 32;
    oAlpha = 1;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU + t * 0.15;
      const len = STAR_RO * (1.9 + 1.2 * (0.5 + 0.5 * Math.sin(t * 3.1 + k * 2.3))) * (k % 4 === 0 ? 1.35 : k % 2 ? 0.7 : 1.0) * L0;
      for (let s = STAR_RO * 0.55; s <= len; s += 0.5) {
        const f = 1 - s / Math.max(len, 1e-6);
        const c = Math.round(cc + Math.cos(a) * s), r = Math.round(rc - (Math.sin(a) * s) / RATIO);
        oput(c, r, 1e6 - s, scale(WARM_WHITE, 0.45 + 0.6 * f), 0.4 + 0.7 * f);
      }
    }
  }

  function splatOrnaments() {
    litCount = 0;
    for (const L of lights) {
      if (P <= L.at) continue;
      litCount++;
      const R = radiusAt(L.yN) + L.rad * 0.65;
      const phi = L.u * TAU - rot;
      const tw = 0.5 + 0.5 * Math.sin(now * L.sp + L.ph);
      const glow = L.big ? 0.9 + 0.2 * tw : 0.55 + 0.75 * tw;
      oAlpha = clamp01((P - L.at) / BLEND);
      const lk = litRow(L.row);
      let col = L.col;
      if (lk > 0) col = mix(col, L.big ? LIT_BALLS[(L.ph * 10 | 0) % LIT_BALLS.length] : WARM_WHITE, lk);
      splatSphere(R * Math.sin(phi), L.row, R * Math.cos(phi), L.rad, scale(col, glow * (1 + (L.big ? 0.3 : 0.6) * lk)), L.big ? 1 + 0.9 * lk : 0.5 + 0.6 * lk);
    }
    oAlpha = 1;
  }

  /* ============================================================
   *  트리 표면 음영
   * ============================================================ */
  function whiteFactor(r, ft) {
    if (ft < 0) return 0;
    const delay = bottomUp(r) * 1.0;
    const up = clamp01((ft - delay) / 0.3);
    const down = clamp01((ft - F.BACK - delay) / 0.3);
    return up * (1 - down);
  }

  function shadeCell(i, sr, c, ft, ny) {
    const y = ZS[i * 3], x = ZS[i * 3 + 1], z = ZS[i * 3 + 2];
    const row = Math.round(y);
    const yN = (y - TREE_TOP) / TREE_SPAN;
    const phi = Math.atan2(x, z);
    const u = frac((phi + rot) / TAU);
    const uq = Math.floor(u * U_Q);
    const h = h2(uq, row);

    const nx = Math.sin(phi), nz = Math.cos(phi);
    const nm = Math.hypot(nx, ny, nz);
    const diff = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nm);
    const spec = Math.pow(Math.max(0, (nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) / nm), 22);
    const facing = Math.max(0, (ny * VIEW[1] + nz * VIEW[2]) / nm);
    const edge = facing < 0.22;
    if (edge && h < 0.3) return;

    const appear = lerpIn(S.BUILD, clamp01(bottomUp(row) * 0.93 + h * 0.07));
    if (P < appear) return;
    const fadeIn = clamp01((P - appear) / 0.006);

    // 단 그늘: 각 단의 윗부분은 윗단 치마 밑이라 어둡고, 자락은 밝음
    const tf = frac(yN * 6 * 0.999);
    const ao = 0.28 + 0.72 * Math.pow(tf, 0.55);
    const limb = 0.4 + 0.6 * facing;
    const jit = (h2(uq, row + 331) - 0.5) * 0.12;

    // 나선형 잎 리본 2줄 + 잎 결 (세밀 묘사)
    const s = frac(2 * u + yN * 6);
    const inRib = s < 0.76;
    let b;
    if (inRib) {
      const prof = Math.sin(Math.PI * s / 0.76);
      const needle = 0.85 + 0.15 * Math.sin((u * 90 + yN * 40) * Math.PI + h * 3);   // 잎 결
      b = (0.05 + 0.95 * diff * (0.45 + 0.55 * prof)) * ao * limb * needle + spec * 0.55 * prof + jit;
    } else {
      b = (0.03 + 0.28 * diff) * ao + jit * 0.5;
    }
    if (z < 0) b *= 0.55;
    b = clamp01(b);

    const hl = h2(uq, row + 977);
    let bucket = bucketOf(b);
    let color = mix(scale(C.white, 0.25 + 0.75 * b), greenShade(b), clamp01((P - greenAt(row, h)) / BLEND));

    // 반짝이 (색 글자 흩뿌림)
    const hs = h2(uq + 7001, row);
    if (hs < 0.15 && inRib) {
      const early = hs < 0.055;
      const pal = early ? SPARK_EARLY : SPARK_LATE;
      const sc = pal[(h2(uq + 13, row + 5) * pal.length) | 0];
      const at = lerpIn(early ? S.YEL : S.RED, clamp01(bottomUp(row) * 0.85 + hs * 0.9));
      const k = clamp01((P - at) / BLEND);
      if (k > 0) {
        const tw = 0.55 + 0.45 * Math.sin(now * (2 + hs * 30) + hl * 20);
        color = mix(color, scale(sc, (0.25 + 0.85 * Math.max(b, diff * limb)) * (0.7 + 0.5 * tw)), k);
        if (k > 0.5) bucket = Math.max(bucket, 1);
      }
    }
    const ww = whiteFactor(row, ft);
    if (ww > 0) color = mix(color, C.white, ww);

    // 마지막 점등: 잎이 금빛으로 물들고, 표면 곳곳에 따뜻한 꼬마전구가 켜짐
    const lk = litRow(row);
    if (lk > 0) {
      color = mix(color, scale(litFoliage(b), 0.85 + 0.3 * lk), lk * 0.9);
      const hf = h2(uq + 3001, row);
      if (hf < 0.36 && facing > 0.1) {
        const tw = 0.6 + 0.4 * Math.sin(now * (3 + hf * 25) + hl * 30);
        const on = clamp01((lk - hf * 1.2) * 3);                               // 전구가 하나씩 켜지듯
        color = mix(color, scale(WARM_WHITE, (0.7 + 0.4 * facing) * (0.75 + 0.45 * tw)), on);
        if (on > 0.5) bucket = 2;
      }
      // 글리터: 곳곳이 짧게 하얗게 번쩍임
      const hg = h2(uq + 911, row);
      if (hg < 0.45) {
        const flash = Math.pow(Math.max(0, Math.sin(now * (1.5 + hg * 6) + hg * 200)), 40) * lk;
        if (flash > 0.05) {
          color = mix(color, C.white, Math.min(1, flash * 1.4));
          if (flash > 0.3) bucket = 2;
        }
      }
    }
    emit(treeC0 + c, treeR0 + sr, RAMP[bucket][(hl * 4) | 0], color, (inRib ? 1 : 0.85) * fadeIn, bucket);
  }

  /* ============================================================
   *  타이틀 PROTO / MERRY / CHRISTMAS (P R O T O 로 채움, 트리 뒤)
   * ============================================================ */
  const TITLE_PALETTE = [C.red, C.gold, C.neon, C.blue, C.orange, C.purple];
  const titleFont = px => `900 ${px}px ${KR}`;
  let titleCells = [];
  let titleDirty = true;

  function sampleWord(str, fontPx) {
    const font = titleFont(fontPx);
    octx.font = font;
    const pad = SX * 2;
    const w = Math.ceil(octx.measureText(str).width) + pad * 2;
    const cols = Math.ceil(w / SX);
    const rows = Math.ceil((fontPx * 1.3) / SY);
    off.width = cols * SX;
    off.height = Math.ceil(rows * SY);
    octx.font = font;
    octx.fillStyle = '#fff';
    octx.textBaseline = 'middle';
    octx.textAlign = 'left';
    octx.fillText(str, pad, off.height / 2);
    const bounds = [...str].map((_, i) => pad + octx.measureText(str.slice(0, i + 1)).width);
    const data = octx.getImageData(0, 0, off.width, off.height).data;

    const out = [];
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * SX), y0 = Math.floor(r * SY);
        const x1 = Math.floor((c + 1) * SX), y1 = Math.min(off.height, Math.floor((r + 1) * SY));
        let sum = 0, n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) { sum += data[(y * off.width + x) * 4 + 3]; n++; }
        }
        if (n && sum / n / 255 > 0.45) {
          const xc = (c + 0.5) * SX;
          let ci = bounds.findIndex(b => xc < b);
          if (ci < 0) ci = str.length - 1;
          out.push({ c, r, ci });
          minC = Math.min(minC, c); maxC = Math.max(maxC, c);
          minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        }
      }
    }
    if (!out.length) return { cols: 1, rows: 1, cells: [] };
    for (const p of out) { p.c -= minC; p.r -= minR; }
    return { cols: maxC - minC + 1, rows: maxR - minR + 1, cells: out };
  }

  function fitWord(str, targetCols) {
    let px = 120;
    let s = sampleWord(str, px);
    if (!s.cells.length) return { s, px };                // 글자 모양을 못 읽으면(폰트 문제 등) 크기 계산 중단
    for (let i = 0; i < 2; i++) { px = px * targetCols / s.cols; s = sampleWord(str, px); }
    while (s.cols > targetCols && px > 8) { px *= 0.97; s = sampleWord(str, px); }
    return { s, px };
  }

  // 트리(별·볼·선물 포함)를 피해 하늘 영역의 빈 곳에 단어를 배치.
  // 단어마다 들어갈 수 있는 가장 큰 크기를 찾고, 같은 크기면 단어별 기준 위치에 가까운 곳으로.
  function buildTitle() {
    titleDirty = false;
    titleCells = [];
    const sky = horizon;                                   // 지면(아래 1/3) 위 하늘 영역
    const M = new Uint8Array(GC * GRW);                    // 1 = 못 쓰는 칸
    const block = (c0, r0, c1, r1) => {
      for (let r = Math.max(0, r0); r <= Math.min(GRW - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(GC - 1, c1); c++) M[r * GC + c] = 1;
      }
    };
    // 트리 실루엣 + 선물 (볼이 튀어나오는 만큼 여유)
    const padC = Math.ceil(3 * K), padR = Math.ceil(2 * K);
    for (let i = 0; i < NCELL; i++) {
      if (!ZK[i] && GD[i] <= -1e8) continue;
      const r = treeR0 + ((i / COLS) | 0), c = treeC0 + (i % COLS);
      block(c - padC, r - padR, c + padC, r + padR);
    }
    // 별 자리
    block(Math.floor(treeC0 + CX - STAR_RO - padC), 0, Math.ceil(treeC0 + CX + STAR_RO + padC), Math.ceil(treeR0 + TREE_SHIFT + TREE_TOP + padR));
    // 왼쪽 위 정보 표시(HUD), 지면
    block(0, 0, Math.ceil(170 / cw), Math.ceil(100 / ch));
    block(0, sky - 1, GC - 1, GRW - 1);

    // 빠른 빈칸 검사용 누적합
    const W1 = GC + 1;
    const SAT = new Int32Array(W1 * (GRW + 1));
    const rebuild = () => {
      for (let r = 0; r < GRW; r++) {
        let run = 0;
        for (let c = 0; c < GC; c++) {
          run += M[r * GC + c];
          SAT[(r + 1) * W1 + c + 1] = SAT[r * W1 + c + 1] + run;
        }
      }
    };
    const boxFree = (c0, r0, c1, r1) => {
      if (c0 < 0 || r0 < 0 || c1 >= GC || r1 >= GRW) return false;
      return SAT[(r1 + 1) * W1 + c1 + 1] - SAT[r0 * W1 + c1 + 1] - SAT[(r1 + 1) * W1 + c0] + SAT[r0 * W1 + c0] === 0;
    };
    rebuild();

    // 배치: PROTO = 트리 왼쪽에 크게 / MERRY·CHRISTMAS = 트리 오른쪽에 같은 글자 높이로 위아래
    const gapC = 3, gapR = 2;
    const tcx = Math.round(treeC0 + CX);                   // 트리 가운데 열
    const fits = (c0, r0, s) => boxFree(c0 - gapC, r0 - gapR, c0 + s.cols - 1 + gapC, r0 + s.rows - 1 + gapR);
    // 조건을 만족하는 자리 중 기준 행에 가장 가까운 행 → 그 행에서 가능한 열 범위의 가운데
    const choose = (rMax, cMin, cMax, ok, anchorR) => {
      let bestR = -1, bestD = Infinity;
      for (let r0 = 1; r0 <= rMax; r0++) {
        const d = Math.abs(r0 - anchorR);
        if (d >= bestD) continue;
        for (let c0 = cMin; c0 <= cMax; c0++) if (ok(c0, r0)) { bestR = r0; bestD = d; break; }
      }
      if (bestR < 0) return null;
      const cs = [];
      for (let c0 = cMin; c0 <= cMax; c0++) if (ok(c0, bestR)) cs.push(c0);
      return { r0: bestR, c0: cs[Math.floor(cs.length / 2)] };
    };
    const place = (word, li, s, c0, r0) => {
      block(c0 - gapC, r0 - gapR, c0 + s.cols - 1 + gapC, r0 + s.rows - 1 + gapR);
      for (const p of s.cells) {
        titleCells.push({
          col: c0 + p.c, row: r0 + p.r,
          ch: hashLetter(p.c + li * 101, p.r),
          color: li === 0 ? C.white : TITLE_PALETTE[(p.ci + li * 2) % TITLE_PALETTE.length],
          delay: T0 + li * T_GAP + (p.c / s.cols) * T_SWEEP + Math.random() * 0.06,
        });
      }
    };

    // 1) 오른쪽: MERRY / CHRISTMAS 같은 크기로, 들어가는 가장 큰 크기
    let rightCenter = sky * 0.45;
    {
      let px = fitWord('CHRISTMAS', GC - 4).px, got = null;
      while (px > 6 && !got) {
        const sm = sampleWord('MERRY', px), sc = sampleWord('CHRISTMAS', px);
        const lineGap = Math.max(2, Math.round(sm.rows * 0.3));
        const Hb = sm.rows + lineGap + sc.rows;
        if (Hb <= sky - 2 && sc.cols <= GC - tcx) {
          const pos = choose(sky - 1 - Hb, tcx + 1, GC - 2 - Math.max(sm.cols, sc.cols),
            (c0, r0) => fits(c0, r0, sm) && fits(c0, r0 + sm.rows + lineGap, sc), sky * 0.45 - Hb / 2);
          if (pos) got = { sm, sc, lineGap, Hb, ...pos };
        }
        if (!got) px *= 0.95;
      }
      if (got) {
        place('MERRY', 1, got.sm, got.c0, got.r0);
        place('CHRISTMAS', 2, got.sc, got.c0, got.r0 + got.sm.rows + got.lineGap);   // 왼쪽 끝 맞춤
        rightCenter = got.r0 + got.Hb / 2;
        rebuild();
      }
    }

    // 2) 왼쪽: PROTO 크게, 세로 중심을 오른쪽 묶음에 맞춤
    {
      let px = fitWord('PROTO', GC - 4).px, got = null;
      while (px > 6 && !got) {
        const sp = sampleWord('PROTO', px);
        if (sp.rows <= sky - 2 && sp.cols < tcx) {
          const pos = choose(sky - 1 - sp.rows, 1, tcx - 1 - sp.cols, (c0, r0) => fits(c0, r0, sp), rightCenter - sp.rows / 2);
          if (pos) got = { sp, ...pos };
        }
        if (!got) px *= 0.95;
      }
      if (got) place('PROTO', 0, got.sp, got.c0, got.r0);
    }
  }


  // 트리가 칸을 먼저 차지한 뒤 호출 → 트리에 가린 칸은 안 그려짐 (트리가 앞)
  function drawTitle(ft, t) {
    if (ft < T0) return;
    if (titleDirty) buildTitle();
    const shown = [];
    // 별 위치 (화면 칸) — 글자 점등이 여기서부터 퍼짐
    const starC = treeC0 + CX, starR = treeR0 + TREE_SHIFT + STAR_CY;
    let starMaxD = 1;
    for (const tc of titleCells) starMaxD = Math.max(starMaxD, Math.hypot(tc.col - starC, (tc.row - starR) * RATIO));
    for (const tc of titleCells) {
      if (ft < tc.delay) continue;
      const k = clamp01((ft - tc.delay) / 0.3);
      const shimmer = 0.82 + 0.18 * Math.sin(t * 3 - tc.col * 0.12 + tc.row * 0.2);
      let col = mix(C.white, scale(tc.color, shimmer), k);

      // 나무 점등 중간쯤부터 글자도 금빛 조명으로 — 별을 중심으로 가까운 칸부터 퍼져 나감
      const sd = Math.hypot(tc.col - starC, (tc.row - starR) * RATIO) / starMaxD;
      const tk = smooth((ft - TITLE_LIT_T - sd * 1.6) / 0.8);
      if (tk > 0) {
        const h = h2(tc.col * 5 + 1, tc.row * 3 + 2);
        const gold = mix([236, 170, 50], WARM_WHITE, 0.35 + 0.65 * h2(tc.col, tc.row + 9));   // 금 ~ 따뜻한 흰빛
        col = mix(col, scale(gold, 0.8 + 0.2 * shimmer), tk);
        if (h < 0.38) {                                                         // 꼬마전구
          const tw = 0.6 + 0.4 * Math.sin(t * (3 + h * 25) + h * 90);
          const on = clamp01((tk - h * 1.5) * 3);
          col = mix(col, scale(WARM_WHITE, 0.8 + 0.4 * tw), on);
        }
        const hg = h2(tc.col + 911, tc.row);
        if (hg < 0.45) {                                                        // 글리터 번쩍임
          const flash = Math.pow(Math.max(0, Math.sin(t * (1.5 + hg * 6) + hg * 200)), 40) * tk;
          if (flash > 0.05) col = mix(col, C.white, Math.min(1, flash * 1.4));
        }
      }
      if (emit(tc.col, tc.row, tc.ch, col, clamp01((ft - tc.delay) / 0.06), 2)) shown.push(tc);
    }
    // 획 둘레 한 칸 비우기 (눈·별과 섞이지 않게)
    for (const tc of shown) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) claim(tc.col + dx, tc.row + dy, 5);
      }
    }
  }

  /* ============================================================
   *  장면 합성
   * ============================================================ */
  function drawScene(t) {
    const ft = finaleStart == null ? -1 : t - finaleStart;
    now = t;
    curFt = ft;

    // 3D 물체
    OD.fill(-1e9);
    splatOrnaments();
    splatGarland();
    let starYellow = false;
    if (ft >= F.STAR) {
      starYellow = (ft >= F.Y1 && ft < F.W2) || ft >= F.Y2;
      splatStar(ft, starYellow, t);
      if (litAll() > 0) splatStarBurst(t);
    }

    // 칸마다 가장 앞에 있는 것: 트리 표면 or 3D 물체
    const ny = (BASE_R / TREE_SPAN) / RATIO;   // 원뿔 법선의 위쪽 성분
    for (let i = 0; i < NCELL; i++) {
      const sr = (i / COLS) | 0, c = i % COLS;
      const gc = treeC0 + c, gr = treeR0 + sr;
      // 선물 상자는 항상 맨 앞 (트리·볼·가랜드보다 앞)
      const gd0 = P >= GAP[i] ? GD[i] : -1e9;
      const od = gd0 > -1e8 ? -1e9 : OD[i];
      const gd = gd0 > -1e8 ? 1e9 : -1e9;
      const objD = Math.max(od, gd);
      if (ZK[i] && ZB[i] >= objD) {
        const before = claimed(gc, gr);
        shadeCell(i, sr, c, ft, ny);
        if (claimed(gc, gr) !== before || objD <= -1e8) continue;
      }
      if (objD <= -1e8) continue;
      const ww = whiteFactor(sr, ft);
      const hl = h2(c * 7 + 3, sr);
      if (od >= gd) {
        let col = [OCOL[i * 3], OCOL[i * 3 + 1], OCOL[i * 3 + 2]];
        if (ww > 0) col = mix(col, C.white, ww);
        const bk = bucketOf(Math.min(1, OB[i]));
        emit(gc, gr, RAMP[bk][(hl * 4) | 0], col, OA[i], bk);
      } else {
        // 선물 상자: 흰색으로 생겼다가 제 색으로
        const b = GB[i];
        let col = mix(scale(C.white, 0.3 + 0.7 * b), [GCOL[i * 3], GCOL[i * 3 + 1], GCOL[i * 3 + 2]], clamp01((P - GAP[i] - 0.012) / BLEND));
        if (ww > 0) col = mix(col, C.white, ww);
        const bk = bucketOf(b);
        emit(gc, gr, RAMP[bk][(hl * 4) | 0], col, clamp01((P - GAP[i]) / 0.006), bk);
      }
    }

    // 타이틀 (트리 뒤) → 이름 입력 → 눈송이 → 원근 지면 → 별
    if (ft >= 0) drawTitle(ft, t);
    if (started && count < total) placeInput(t);
    drawFlakes();
    drawAirSparkles(t);
    drawFloor(t);
    drawBackground(t);

    return { ft, starYellow };
  }

  // 별 주변의 은은한 빛만 남김 (전체 빛번짐 효과는 제거)
  function drawTreeHalo() {
    const k = litAll();
    if (k <= 0) return;
    const x = cx(treeC0 + CX), y = cy(treeR0 + TREE_SHIFT + TREE_TOP + TREE_SPAN * 0.55);
    const rad = ch * TREE_SPAN * 0.85;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(255,200,110,${0.22 * k})`);
    g.addColorStop(0.5, `rgba(255,170,70,${0.09 * k})`);
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  function drawStarGlow(ft, yellow, t) {
    if (ft < F.STAR) return;
    const x = cx(treeC0 + CX);
    const y = cy(treeR0 + TREE_SHIFT + STAR_CY);
    const pulse = ft > F.END ? 0.8 + 0.2 * Math.sin(t * 2.4) : 1;
    const rad = cw * 9 * K * (1 + 0.8 * litAll());
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = yellow ? '255,180,20' : '255,255,255';
    g.addColorStop(0, `rgba(${c},${0.28 * pulse})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================================================
   *  루프
   * ============================================================ */
  let last = performance.now() / 1000;
  let hudTick = 0;

  function frame(ms) {
    const t = ms / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;
    rot = (rot + ROT_SPEED * dt) % TAU;

    if (tween) {
      const k = clamp01((t - tween.start) / tween.dur);
      P = tween.from + (tween.to - tween.from) * k;
      if (k >= 1) tween = null;
    }
    if (started && !tween && total > 0 && count >= total && finaleStart == null) {
      finaleStart = t;
      nameInput.blur();
    }
    if (finaleStart != null && !doneShown && t - finaleStart > TITLE_LIT_T + 2.8) {
      doneShown = true;
      restartBtn.classList.remove('hidden');
    }

    updateSnow(dt);
    occ.fill(0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#03050b';
    ctx.fillRect(0, 0, W, H);

    const { ft, starYellow } = drawScene(t);
    drawTreeHalo();
    drawStarGlow(ft, starYellow, t);
    flush(ctx);

    if (started && t - hudTick > 0.1) {
      hudTick = t;
      hudRot.textContent = `rotation ${((rot * 180) / Math.PI).toFixed(2)}°`;
      hudLights.textContent = `lights ${litCount}`;
    }

    requestAnimationFrame(frame);
  }

  /* ============================================================
   *  입력 / 흐름
   * ============================================================ */
  function updateHud() {
    const pad = n => String(n).padStart(2, '0');
    hudMembers.textContent = `members ${pad(count)} / ${pad(total)}`;
    hudLetters.textContent = `letters ${letterCount.toLocaleString()}`;
  }

  function start() {
    const n = parseInt(countInput.value, 10);
    if (!Number.isFinite(n) || n < 1) { countInput.focus(); return; }
    total = Math.min(999, n);
    count = 0; letterCount = 0; P = 0; tween = null; finaleStart = null; doneShown = false;
    started = true;
    titleDirty = true;
    if (document.fonts && document.fonts.load) document.fonts.load(titleFont(100), TITLE.join('')).catch(() => {});
    setup.classList.add('hidden');
    restartBtn.classList.add('hidden');
    [hud, sendBtn, hint, nameInput].forEach(el => el.classList.remove('hidden'));
    nameInput.value = '';
    refreshGlyph();
    updateHud();
    nameInput.focus();
  }

  function submit() {
    if (!started || count >= total) return;
    const v = nameInput.value.trim();
    if (!v) { nameInput.focus(); return; }
    letterCount += fitGlyph(v).lines.reduce((s, l) => s + l.cells.length, 0);
    count++;
    nameInput.value = '';
    refreshGlyph();
    updateHud();

    const to = count >= total ? P_END : (count / total) * P_END;
    const from = P;
    tween = { from, to, start: performance.now() / 1000, dur: 1.4 + 5 * (to - from) };

    if (count >= total) {
      [sendBtn, hint, nameInput].forEach(el => el.classList.add('hidden'));
    } else {
      nameInput.focus();
    }
  }

  function restart() {
    started = false;
    P = 0; tween = null; finaleStart = null; doneShown = false; count = 0; letterCount = 0;
    restartBtn.classList.add('hidden');
    [hud, sendBtn, hint, nameInput].forEach(el => el.classList.add('hidden'));
    setup.classList.remove('hidden');
    countInput.value = '';
    countInput.focus();
  }

  nameInput.addEventListener('input', refreshGlyph);
  nameInput.addEventListener('compositionupdate', () => setTimeout(refreshGlyph, 0));
  nameInput.addEventListener('compositionend', () => setTimeout(refreshGlyph, 0));
  nameInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  });
  sendBtn.addEventListener('click', submit);
  sendBtn.addEventListener('mousedown', e => e.preventDefault());

  startBtn.addEventListener('click', start);
  countInput.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
  restartBtn.addEventListener('click', restart);

  window.addEventListener('keydown', () => {
    if (started && count < total && document.activeElement !== nameInput) nameInput.focus();
  });
  window.addEventListener('resize', layout);

  [hud, sendBtn, hint, nameInput].forEach(el => el.classList.add('hidden'));
  layout();
  countInput.focus();
  requestAnimationFrame(frame);
})();
