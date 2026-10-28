// Nav menu, current-section highlighting, scroll reveals and the tagline word reveal.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  var toggle = document.querySelector('.menu-toggle');
  var menu = document.getElementById('mobile-menu');
  if (toggle && menu) {
    var items = Array.prototype.slice.call(menu.children);
    var step = Math.min(60, Math.floor(400 / Math.max(items.length, 1)));
    items.forEach(function (el, i) { el.style.transitionDelay = (i * step) + 'ms'; });
    var setOpen = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) {
        menu.hidden = false;
        void menu.offsetHeight; // commit the hidden state so the entrance transitions run
        menu.classList.add('open');
      } else {
        menu.classList.remove('open');
        setTimeout(function () { if (!menu.classList.contains('open')) menu.hidden = true; }, 300);
      }
    };
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); toggle.focus(); } });
  }

  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    document.querySelectorAll('.tagline .word').forEach(function (el) { el.classList.add('on'); });
    return;
  }

  // Current section in the nav
  var links = document.querySelectorAll('.nav-links a');
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  var navObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      links.forEach(function (a) { a.removeAttribute('aria-current'); });
      var link = byId[entry.target.id];
      if (link) link.setAttribute('aria-current', 'true');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach(function (s) { navObserver.observe(s); });

  // Section reveals, once each
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add('in'); revealObserver.unobserve(entry.target); }
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.reveal').forEach(function (el) { revealObserver.observe(el); });

  // Tagline: wrap each word, then light words one by one as they cross the trigger line
  var tagline = document.querySelector('.tagline p');
  if (tagline) {
    tagline.querySelectorAll('.line').forEach(function (line) {
      var gold = line.classList.contains('gold');
      line.innerHTML = line.textContent.trim().split(/\s+/).map(function (w) {
        return '<span class="word' + (gold ? ' gold' : '') + '">' + w + '</span>';
      }).join(' ');
    });
    var words = tagline.querySelectorAll('.word');
    if (reduce) { words.forEach(function (w) { w.classList.add('on'); }); return; }
    var queue = [];
    var flushing = false;
    var flush = function () {
      var next = queue.shift();
      if (!next) { flushing = false; return; }
      next.classList.add('on');
      setTimeout(flush, 70);
    };
    var wordObserver = new IntersectionObserver(function (entries) {
      entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.target.dataset.i - b.target.dataset.i; })
        .forEach(function (e) { queue.push(e.target); wordObserver.unobserve(e.target); });
      if (!flushing && queue.length) { flushing = true; flush(); }
    }, { rootMargin: '0px 0px -35% 0px' });
    words.forEach(function (w, i) { w.dataset.i = i; wordObserver.observe(w); });
  }
})();
