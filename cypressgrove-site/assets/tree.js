// The cypress from the seal, drawn as points.
// Hero: the seal's ring with its tree rebuilt from points; the tree grows in,
// sways, parts around the pointer and ripples on tap.
// Grove: a faint cypress swamp along the bottom of the screen that gains a tree
// as the reader moves down the page, with reflections and ripples on the water.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var GREEN = '30,91,67', DEEP = '21,63,48', GOLD = '169,138,60';

  // tree-source.png is the tree cut from logo.png at (300, 340), 460x540.
  // seal-hi.png is the seal cut from logo.png at (92, 182), 868x868, scaled to 640.
  var SRC = { w: 460, h: 540 };
  var SEAL = { size: 868, cx: 434, cy: 434, outer: 433, inner: 306, treeX: 208, treeY: 158 };
  var TREE_IN_CIRCLE = { x: 226, y: 276, r: 292 }; // seal's inner circle, in tree-source pixels
  var BASE_Y = 470; // where the roots meet the water, in tree-source pixels

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Every dark pixel of the tree, with its darkness; callers pick subsets.
  function samplePixels(img) {
    var c = document.createElement('canvas');
    c.width = SRC.w; c.height = SRC.h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var d = g.getImageData(0, 0, SRC.w, SRC.h).data;
    var out = [];
    for (var y = 0; y < SRC.h; y++) {
      for (var x = 0; x < SRC.w; x++) {
        var dx = x - TREE_IN_CIRCLE.x, dy = y - TREE_IN_CIRCLE.y;
        if (dx * dx + dy * dy > TREE_IN_CIRCLE.r * TREE_IN_CIRCLE.r) continue;
        var i = (y * SRC.w + x) * 4;
        var dark = 1 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
        if (dark > 0.25) out.push({ sx: x, sy: y, a: dark });
      }
    }
    return out;
  }

  // Pick n pixels, favoring darker ones, so the drawing keeps its structure.
  function pickPoints(pixels, n, filter) {
    var pool = filter ? pixels.filter(filter) : pixels;
    var out = [];
    var keep = Math.min(1, n / (pool.length * 0.55));
    for (var i = 0; i < pool.length && out.length < n * 1.2; i++) {
      var p = pool[i];
      if (Math.random() < keep * Math.pow(p.a, 0.9)) out.push({ sx: p.sx, sy: p.sy, a: p.a });
    }
    for (var j = out.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = out[j]; out[j] = out[k]; out[k] = t;
    }
    return out.slice(0, n);
  }

  // Draw points batched by color and opacity
  function drawPoints(ctx, list, size, alphaScale, colorOf) {
    var buckets = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.hidden) continue;
      var key = colorOf(p) + '|' + Math.round(p.a * 5);
      (buckets[key] || (buckets[key] = [])).push(p);
    }
    Object.keys(buckets).forEach(function (key) {
      var parts = key.split('|');
      var alpha = (0.2 + Number(parts[1]) / 5 * 0.8) * alphaScale;
      ctx.fillStyle = 'rgba(' + parts[0] + ',' + alpha.toFixed(3) + ')';
      var l = buckets[key];
      for (var j = 0; j < l.length; j++) ctx.fillRect(l[j].x - size / 2, l[j].y - size / 2, size, size);
    });
  }

  var imageReady = loadImage('/cypressgrove-site/assets/tree-source.png');
  var pixelsReady = imageReady.then(samplePixels);

  /* ---------------- Hero seal ---------------- */
  (function hero() {
    var section = document.querySelector('.hero');
    var canvas = document.querySelector('.hero-canvas');
    var stage = document.querySelector('.tree-stage');
    if (!section || !canvas || !stage || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var GRID = 24, REPEL = 70, GLOW = 160;
    var W = 0, H = 0, dpr = 1, seal = { x: 0, y: 0, k: 1 };
    var pts = [], ring = null, gridLayer = null;
    var pointer = { x: -1e4, y: -1e4 };
    var t0 = 0, raf = 0, visible = true;

    function buildRing(img) {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var g = c.getContext('2d');
      var s = img.width / SEAL.size;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.beginPath(); g.arc(SEAL.cx * s, SEAL.cy * s, SEAL.outer * s, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(SEAL.cx * s, SEAL.cy * s, SEAL.inner * s, 0, Math.PI * 2); g.fill();
      return c;
    }

    function layout() {
      var hr = section.getBoundingClientRect();
      var sr = stage.getBoundingClientRect();
      W = Math.round(hr.width); H = Math.round(hr.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      var d = Math.min(sr.width, sr.height);
      seal.k = d / SEAL.size;
      seal.x = sr.left - hr.left + (sr.width - d) / 2;
      seal.y = sr.top - hr.top + (sr.height - d) / 2;

      gridLayer = document.createElement('canvas');
      gridLayer.width = canvas.width; gridLayer.height = canvas.height;
      var g = gridLayer.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = 'rgba(' + GREEN + ',0.09)';
      for (var gy = GRID / 2; gy < H; gy += GRID) {
        for (var gx = GRID / 2; gx < W; gx += GRID) g.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5);
      }
    }

    function home(p, t) {
      var lift = Math.max(0, 1 - p.sy / BASE_Y);
      var sway = reduce ? 0 : Math.sin(t * 0.0009 + p.sy * 0.018) * lift * lift * 4 * seal.k;
      return { x: seal.x + (p.sx + SEAL.treeX) * seal.k + sway, y: seal.y + (p.sy + SEAL.treeY) * seal.k };
    }

    function step(t) {
      var el = t - t0;
      var baseY = seal.y + (BASE_Y + SEAL.treeY) * seal.k;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var h = home(p, el);
        if (p.hidden) {
          if (el < p.delay) continue;
          p.hidden = false;
          p.x = reduce ? h.x : h.x + (Math.random() - 0.5) * 30 * seal.k;
          p.y = reduce ? h.y : baseY;
        }
        var dx = p.x - pointer.x, dy = p.y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < REPEL * REPEL && d2 > 0.01) {
          var d = Math.sqrt(d2), f = (1 - d / REPEL) * 1.4;
          p.vx += dx / d * f; p.vy += dy / d * f;
        }
        p.vx = (p.vx + (h.x - p.x) * 0.05) * 0.85;
        p.vy = (p.vy + (h.y - p.y) * 0.05) * 0.85;
        p.x += p.vx; p.y += p.vy;
        p.hot = Math.abs(h.x - p.x) + Math.abs(h.y - p.y) > 10;
      }
    }

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(gridLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

      // The ring sweeps in clockwise from the top, then stays
      var d = SEAL.size * seal.k;
      var sweep = reduce ? 1 : Math.min(1, (t - t0) / 1400);
      sweep = 1 - Math.pow(1 - sweep, 3);
      if (ring && sweep > 0) {
        ctx.save();
        if (sweep < 1) {
          ctx.beginPath();
          ctx.moveTo(seal.x + d / 2, seal.y + d / 2);
          ctx.arc(seal.x + d / 2, seal.y + d / 2, d, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(ring, seal.x, seal.y, d, d);
        ctx.restore();
      }

      var size = Math.max(1.1, seal.k * 2.8);
      drawPoints(ctx, pts, size, 1, function (p) { return p.hot ? GOLD : (p.a > 0.72 ? DEEP : GREEN); });
    }

    function frame(t) {
      raf = 0;
      if (!t0) t0 = t;
      step(t);
      draw(t);
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

    function ripple(x, y) {
      if (reduce) return;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
        if (d < 150 && d > 0.01) { var f = (1 - d / 150) * 8; p.vx += dx / d * f; p.vy += dy / d * f; }
      }
      kick();
    }

    Promise.all([pixelsReady, loadImage('/cypressgrove-site/assets/seal-hi.png')]).then(function (r) {
      ring = buildRing(r[1]);
      layout();
      var n = W < 640 ? 4200 : 7000;
      pts = pickPoints(r[0], n).map(function (p) {
        return { sx: p.sx, sy: p.sy, a: p.a, x: 0, y: 0, vx: 0, vy: 0, hidden: true,
          delay: reduce ? 0 : 300 + Math.max(0, 1 - p.sy / BASE_Y) * 1500 + Math.random() * 400 };
      });
      section.classList.add('tree-ready');
      if (reduce) { t0 = 1; step(1); draw(1); }
      kick();

      function local(e) { var b = section.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
      section.addEventListener('pointermove', function (e) { var p = local(e); pointer.x = p.x; pointer.y = p.y; kick(); });
      section.addEventListener('pointerleave', function () { pointer.x = pointer.y = -1e4; });
      stage.addEventListener('pointerdown', function (e) { var p = local(e); ripple(p.x, p.y); });
      if ('ResizeObserver' in window) {
        new ResizeObserver(function () { layout(); if (reduce) draw(1); kick(); }).observe(section);
      }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) kick(); }).observe(section);
      }
      document.addEventListener('visibilitychange', function () { visible = !document.hidden; if (visible) kick(); });
    }).catch(function () { /* the seal image stays as the fallback */ });
  })();

  /* ---------------- Background grove ---------------- */
  (function grove() {
    var canvas = document.querySelector('.grove');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    // Appearance order: edges first, then inward, so the grove closes in on the last call to action
    var SLOTS = [
      { x: 0.05, s: 0.80 }, { x: 0.95, s: 0.85 }, { x: 0.16, s: 0.55 }, { x: 0.86, s: 0.60 },
      { x: 0.26, s: 0.95 }, { x: 0.74, s: 0.90 }, { x: 0.37, s: 0.50 }, { x: 0.63, s: 0.55 },
      { x: 0.45, s: 0.75 }, { x: 0.55, s: 1.00 }
    ];
    var RISE = 1800, LIFE = 1800;
    var W = 0, H = 0, dpr = 1, horizon = 0, maxH = 0, mobile = false;
    var sprite = null, trees = [], ripples = [];
    var raf = 0, last = 0, lastRipple = 0, lastPos = { x: -1e4, y: -1e4 };

    // The tree drawing, tinted deep green, with the paper made transparent
    function buildSprite(img) {
      var c = document.createElement('canvas');
      c.width = SRC.w; c.height = BASE_Y;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      var data = g.getImageData(0, 0, c.width, c.height);
      var d = data.data;
      for (var y = 0; y < c.height; y++) {
        for (var x = 0; x < c.width; x++) {
          var i = (y * c.width + x) * 4;
          var dx = x - TREE_IN_CIRCLE.x, dy = y - TREE_IN_CIRCLE.y;
          var dark = 1 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
          var inside = dx * dx + dy * dy <= TREE_IN_CIRCLE.r * TREE_IN_CIRCLE.r;
          d[i] = 21; d[i + 1] = 63; d[i + 2] = 48;
          d[i + 3] = inside ? Math.max(0, Math.min(255, (dark - 0.1) / 0.9 * 255)) : 0;
        }
      }
      g.putImageData(data, 0, 0);
      return c;
    }

    function layout() {
      W = window.innerWidth; H = window.innerHeight;
      mobile = W < 640;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      horizon = Math.round(H * (mobile ? 0.88 : 0.85));
      maxH = Math.min(H * (mobile ? 0.24 : 0.32), 320);
    }

    function build() {
      var slots = mobile ? SLOTS.filter(function (_, i) { return i < 2 || i === 4 || i === 5 || i === 9; }) : SLOTS;
      trees = slots.map(function (slot, i) {
        return { slot: slot, flip: i % 2 === 1, born: 0, phase: i * 1.7,
          threshold: 0.04 + i * (0.86 / Math.max(1, slots.length - 1)) };
      });
    }

    function progress() {
      var max = document.documentElement.scrollHeight - H;
      return max > 0 ? window.scrollY / max : 1;
    }

    function draw(t) {
      var p = progress();
      trees.forEach(function (tree) { if (!tree.born && p >= tree.threshold) tree.born = t; });
      ripples = ripples.filter(function (r) { return t - r.t < LIFE; });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var born = trees.filter(function (tr) { return tr.born; });
      if (!born.length) return false;
      var busy = false;

      // Waterline
      ctx.fillStyle = 'rgba(' + GREEN + ',0.12)';
      for (var x = 0; x < W; x += 6) ctx.fillRect(x, horizon, 2, 1);

      born.forEach(function (tree) {
        var g = reduce ? 1 : Math.min(1, (t - tree.born) / RISE);
        if (g < 1) busy = true;
        var e = 1 - Math.pow(1 - g, 3);
        var h = maxH * tree.slot.s;
        var w = h * SRC.w / BASE_Y;
        var cx = tree.slot.x * W;
        var alpha = (0.1 + 0.08 * tree.slot.s) * e;
        var skew = reduce ? 0 : Math.sin(t * 0.0006 + tree.phase) * 0.012;

        // Tree: rises out of the water, sways from its roots
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, horizon); ctx.clip();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, horizon + (1 - e) * h * 0.55);
        ctx.transform(1, 0, -skew, 1, 0, 0);
        if (tree.flip) ctx.scale(-1, 1);
        ctx.drawImage(sprite, -w / 2, -h, w, h);
        ctx.restore();

        // Reflection: flipped, flattened, drawn in strips that shimmer
        var rh = h * 0.42 * e;
        var strip = 3;
        for (var y = 0; y < rh && horizon + y < H; y += strip) {
          var srcY = BASE_Y - (y / rh) * BASE_Y;
          var srcH = Math.max(1, (strip / rh) * BASE_Y);
          var shift = reduce ? 0 : Math.sin(t * 0.0022 + y * 0.35 + tree.phase) * (0.5 + y * 0.05);
          ctx.globalAlpha = alpha * 0.4 * (1 - y / rh);
          ctx.save();
          ctx.translate(cx + shift, horizon + 2 + y);
          if (tree.flip) ctx.scale(-1, 1);
          ctx.drawImage(sprite, 0, srcY - srcH, SRC.w, srcH, -w / 2, 0, w, strip);
          ctx.restore();
        }
      });
      ctx.globalAlpha = 1;

      ripples.forEach(function (r) {
        var age = (t - r.t) / LIFE;
        var rx = 6 + age * 70;
        ctx.strokeStyle = 'rgba(' + GOLD + ',' + ((1 - age) * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rx, rx * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      return busy || ripples.length > 0 || !reduce;
    }

    function frame(t) {
      raf = 0;
      if (t - last < 30) { raf = requestAnimationFrame(frame); return; } // about 30 fps is plenty here
      last = t;
      var keepGoing = draw(t);
      if (!document.hidden && keepGoing && !reduce) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    function addRipple(x, y, force) {
      if (reduce || y < horizon + 4) return;
      if (!trees.some(function (tr) { return tr.born; })) return;
      var now = performance.now();
      if (!force && (now - lastRipple < 160 || Math.hypot(x - lastPos.x, y - lastPos.y) < 18)) return;
      lastRipple = now; lastPos = { x: x, y: y };
      ripples.push({ x: x, y: y, t: now });
      if (ripples.length > 8) ripples.shift();
      kick();
    }

    imageReady.then(function (img) {
      sprite = buildSprite(img);
      layout();
      build();
      kick();
      window.addEventListener('scroll', kick, { passive: true });
      window.addEventListener('resize', function () {
        var wasMobile = mobile;
        layout();
        if (mobile !== wasMobile) build();
        kick();
      });
      window.addEventListener('pointermove', function (e) { addRipple(e.clientX, e.clientY, false); }, { passive: true });
      window.addEventListener('pointerdown', function (e) { addRipple(e.clientX, e.clientY, true); }, { passive: true });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    });
  })();
})();
