// Hero: the cypress from the seal, redrawn as points over a dot grid.
// It grows in from the roots, sways a little, and scatters around the pointer.
(function () {
  var hero = document.querySelector('.hero');
  var canvas = document.querySelector('.hero-canvas');
  var stage = document.querySelector('.tree-stage');
  if (!hero || !canvas || !stage || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SRC_W = 230, SRC_H = 270;          // sampling size of tree-source.png (460x540, halved)
  var CIRCLE = { x: 112.5, y: 137.5, r: 144 }; // inner circle of the seal; outside it is the ring
  var GREEN = '30,91,67', GOLD = '169,138,60';
  var GRID = 24, REPEL = 90, GLOW = 160;

  var W = 0, H = 0, dpr = 1, box = { x: 0, y: 0, s: 1 };
  var source = [], pts = [], gridLayer = null;
  var pointer = { x: -1e4, y: -1e4 };
  var t0 = 0, raf = 0, visible = true;

  var img = new Image();
  img.onload = init;
  img.src = '/cypressgrove-site/assets/tree-source.png';

  function sample() {
    var c = document.createElement('canvas');
    c.width = SRC_W; c.height = SRC_H;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0, SRC_W, SRC_H);
    var d = g.getImageData(0, 0, SRC_W, SRC_H).data;
    var out = [];
    for (var y = 0; y < SRC_H; y++) {
      for (var x = 0; x < SRC_W; x++) {
        var dx = x - CIRCLE.x, dy = y - CIRCLE.y;
        if (dx * dx + dy * dy > CIRCLE.r * CIRCLE.r) continue;
        var i = (y * SRC_W + x) * 4;
        var dark = 1 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
        if (dark > 0.2 && Math.random() < Math.pow(dark, 1.2)) out.push({ sx: x, sy: y, a: dark });
      }
    }
    return out;
  }

  function pick() {
    var target = W < 640 ? 2200 : 4200;
    var copy = source.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    pts = copy.slice(0, target).map(function (p) {
      return { sx: p.sx, sy: p.sy, a: p.a, x: 0, y: 0, vx: 0, vy: 0, born: false,
        delay: reduce ? 0 : (1 - p.sy / SRC_H) * 1400 + Math.random() * 450 };
    });
  }

  function layout() {
    var hr = hero.getBoundingClientRect();
    var sr = stage.getBoundingClientRect();
    W = Math.round(hr.width); H = Math.round(hr.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    var s = Math.min(sr.width / SRC_W, sr.height / SRC_H);
    box.s = s;
    box.x = sr.left - hr.left + (sr.width - SRC_W * s) / 2;
    box.y = sr.top - hr.top + (sr.height - SRC_H * s) / 2;

    // Static dot grid, drawn once per layout
    gridLayer = document.createElement('canvas');
    gridLayer.width = canvas.width; gridLayer.height = canvas.height;
    var g = gridLayer.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = 'rgba(' + GREEN + ',0.09)';
    for (var gy = GRID / 2; gy < H; gy += GRID) {
      for (var gx = GRID / 2; gx < W; gx += GRID) g.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
    }
  }

  function targetOf(p, t) {
    var lift = 1 - p.sy / SRC_H;
    var sway = reduce ? 0 : Math.sin(t * 0.0009 + p.sy * 0.035) * lift * lift * 3.2 * box.s;
    return { x: box.x + p.sx * box.s + sway, y: box.y + p.sy * box.s };
  }

  function step(t) {
    var el = t - t0;
    var base = box.y + SRC_H * box.s * 0.9;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var tg = targetOf(p, el);
      if (!p.born) {
        if (el < p.delay) continue;
        p.born = true;
        p.x = reduce ? tg.x : tg.x + (Math.random() - 0.5) * 24 * box.s;
        p.y = reduce ? tg.y : base + Math.random() * 6;
      }
      var dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy;
      if (d2 < REPEL * REPEL && d2 > 0.01) {
        var d = Math.sqrt(d2), f = (1 - d / REPEL) * 1.6;
        p.vx += dx / d * f; p.vy += dy / d * f;
      }
      p.vx = (p.vx + (tg.x - p.x) * 0.045) * 0.86;
      p.vy = (p.vy + (tg.y - p.y) * 0.045) * 0.86;
      p.x += p.vx; p.y += p.vy;
      p.heat = Math.min(1, Math.hypot(tg.x - p.x, tg.y - p.y) / 22);
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (gridLayer) ctx.drawImage(gridLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Grid dots brighten around the pointer
    if (pointer.x > -1e3) {
      var x0 = Math.max(GRID / 2, Math.floor((pointer.x - GLOW) / GRID) * GRID + GRID / 2);
      var y0 = Math.max(GRID / 2, Math.floor((pointer.y - GLOW) / GRID) * GRID + GRID / 2);
      for (var gy = y0; gy < pointer.y + GLOW && gy < H; gy += GRID) {
        for (var gx = x0; gx < pointer.x + GLOW && gx < W; gx += GRID) {
          var dd = Math.hypot(gx - pointer.x, gy - pointer.y);
          if (dd > GLOW) continue;
          ctx.fillStyle = 'rgba(' + GOLD + ',' + ((1 - dd / GLOW) * 0.55).toFixed(2) + ')';
          ctx.fillRect(gx - 1, gy - 1, 2, 2);
        }
      }
    }

    // Points, batched by color and opacity to keep fillStyle changes few
    var buckets = {};
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p.born) continue;
      var hot = p.heat > 0.35;
      var key = (hot ? 'h' : 'n') + Math.round(p.a * 4);
      (buckets[key] || (buckets[key] = [])).push(p);
    }
    var size = Math.max(1.1, box.s * 0.9);
    Object.keys(buckets).forEach(function (key) {
      var level = Number(key.slice(1)) / 4;
      ctx.fillStyle = 'rgba(' + (key[0] === 'h' ? GOLD : GREEN) + ',' + (0.25 + level * 0.7).toFixed(2) + ')';
      var list = buckets[key];
      for (var j = 0; j < list.length; j++) ctx.fillRect(list[j].x - size / 2, list[j].y - size / 2, size, size);
    });
  }

  function frame(t) {
    raf = 0;
    if (!t0) t0 = t;
    step(t);
    draw();
    if (visible && !reduce) raf = requestAnimationFrame(frame);
  }

  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  function ripple(x, y) {
    if (reduce) return;
    pts.forEach(function (p) {
      var dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
      if (d < 160 && d > 0.01) { var f = (1 - d / 160) * 9; p.vx += dx / d * f; p.vy += dy / d * f; }
    });
    kick();
  }

  function init() {
    source = sample();
    layout();
    pick();
    hero.classList.add('tree-ready');
    if (reduce) { step(0); draw(); }
    kick();

    function local(e) { var r = hero.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    hero.addEventListener('pointermove', function (e) { var p = local(e); pointer.x = p.x; pointer.y = p.y; kick(); });
    hero.addEventListener('pointerleave', function () { pointer.x = pointer.y = -1e4; });
    stage.addEventListener('pointerdown', function (e) { var p = local(e); ripple(p.x, p.y); });

    if ('ResizeObserver' in window) {
      var pending = 0;
      new ResizeObserver(function () {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(function () { layout(); if (reduce) { step(0); draw(); } kick(); });
      }).observe(hero);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; if (visible) kick(); }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () { visible = !document.hidden; if (visible) kick(); });
  }
})();
