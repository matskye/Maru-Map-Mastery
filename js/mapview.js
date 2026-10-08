// MapView: an interactive, zoomable SVG map of Japan.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const M = window.MAP_DATA;
  const D = window.QUIZ_DATA;

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // lat/lon -> SVG coordinates (Okinawa is drawn in an inset box)
  function project(lat, lon) {
    const p = M.proj;
    if (lat < 28.5 && lon < 130) { lon += p.okiDLon; lat += p.okiDLat; }
    return [(lon - p.lon0) * p.kx * p.scale, (p.lat0 - lat) * p.scale];
  }

  class MapView {
    constructor(container) {
      this.base = { x: M.viewBox[0], y: M.viewBox[1], w: M.viewBox[2], h: M.viewBox[3] };
      this.vb = { ...this.base };
      this.handlers = {};
      this.markers = [];
      this.labels = [];
      this.dragMoved = false;

      const root = this.root = svg('svg', { class: 'japan-map', 'aria-label': 'Map of Japan' });
      root.appendChild(this._defs());
      svg('rect', { class: 'sea', x: this.base.x - 2000, y: this.base.y - 2000, width: this.base.w + 4000, height: this.base.h + 4000 }, root);

      const ob = M.okinawaBox;
      svg('rect', { class: 'inset', x: ob[0], y: ob[1], width: ob[2], height: ob[3], rx: 10 }, root);

      this.prefLayer = svg('g', { class: 'prefs' }, root);
      this.paths = {};
      M.prefectures.forEach((p) => {
        const path = svg('path', { d: p.d, class: 'pref', 'data-id': p.id, 'fill-rule': 'evenodd' }, this.prefLayer);
        this.paths[p.id] = path;
      });
      this.centroid = {};
      M.prefectures.forEach((p) => { this.centroid[p.id] = [p.cx, p.cy]; });

      this.labelLayer = svg('g', { class: 'labels' }, root);
      this.markerLayer = svg('g', { class: 'markers' }, root);
      this.fxLayer = svg('g', { class: 'fx' }, root);

      container.appendChild(root);
      container.appendChild(this._controls());
      this.container = container;
      this._applyVB();
      this._bindEvents();
      if (window.ResizeObserver) new ResizeObserver(() => this._applyVB()).observe(container);
    }

    _defs() {
      return svg('defs');
    }

    _controls() {
      const box = document.createElement('div');
      box.className = 'zoom-controls';
      const mk = (txt, label, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = txt; b.setAttribute('aria-label', label); b.title = label;
        b.addEventListener('click', fn);
        box.appendChild(b);
      };
      mk('＋', 'Zoom in / ズームイン', () => this.zoomBy(1.6));
      mk('－', 'Zoom out / ズームアウト', () => this.zoomBy(1 / 1.6));
      mk('⌂', 'Reset view / もとにもどす', () => this.resetView(true));
      return box;
    }

    on(name, fn) { this.handlers[name] = fn; return this; }
    emit(name, ...a) { if (this.handlers[name]) this.handlers[name](...a); }

    get zoom() { return this.base.w / this.vb.w; }

    // ---------- view / zoom / pan ----------
    _applyVB() {
      const v = this.vb;
      this.root.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
      const k = this.zoom;
      const inv = this._inv();
      this.markers.forEach((m) => m.g.setAttribute('transform', `translate(${m.x} ${m.y}) scale(${inv})`));
      this.labels.forEach((l) => l.g.setAttribute('transform', `translate(${l.x} ${l.y}) scale(${inv})`));
      this.fxLayer.querySelectorAll('[data-fx]').forEach((n) => {
        n.setAttribute('transform', `translate(${n.dataset.x} ${n.dataset.y}) scale(${inv})`);
      });
      this.root.classList.toggle('z2', k >= 1.9);
      this.root.classList.toggle('z3', k >= 2.8);
    }

    // SVG units per CSS pixel: markers/labels are drawn in CSS px so they stay the same size at any zoom
    _inv() {
      const r = this.root.getBoundingClientRect();
      if (!r.width || !r.height) return 1 / (this.zoom * 0.6);
      return 1 / Math.min(r.width / this.vb.w, r.height / this.vb.h);
    }

    _clamp(v) {
      const b = this.base;
      v.w = Math.min(b.w, Math.max(b.w / 14, v.w));
      v.h = v.w * (b.h / b.w);
      const mx = b.w * 0.15, my = b.h * 0.15;
      v.x = Math.min(b.x + b.w + mx - v.w, Math.max(b.x - mx, v.x));
      v.y = Math.min(b.y + b.h + my - v.h, Math.max(b.y - my, v.y));
      return v;
    }

    setView(v, animate) {
      const target = this._clamp({ ...v });
      if (!animate) { cancelAnimationFrame(this._anim); this.vb = target; this._applyVB(); return; }
      const from = { ...this.vb }, t0 = performance.now(), dur = 450;
      cancelAnimationFrame(this._anim);
      const step = (t) => {
        const u = Math.min(1, (t - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        this.vb = {
          x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
          w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e,
        };
        this._applyVB();
        if (u < 1) this._anim = requestAnimationFrame(step);
      };
      this._anim = requestAnimationFrame(step);
    }

    resetView(animate) { this.setView({ ...this.base }, animate); }

    zoomBy(f, cx, cy, animate = true) {
      const v = this.vb;
      if (cx == null) { cx = v.x + v.w / 2; cy = v.y + v.h / 2; }
      const w = v.w / f, h = v.h / f;
      this.setView({ x: cx - (cx - v.x) / f, y: cy - (cy - v.y) / f, w, h }, animate);
    }

    focusOn(x, y, k, animate = true) {
      const w = this.base.w / k, h = this.base.h / k;
      this.setView({ x: x - w / 2, y: y - h / 2, w, h }, animate);
    }

    ensureVisible(x, y) {
      const v = this.vb, mx = v.w * 0.12, my = v.h * 0.12;
      if (x < v.x + mx || x > v.x + v.w - mx || y < v.y + my || y > v.y + v.h - my) {
        this.focusOn(x, y, Math.max(this.zoom, 1.6));
      }
    }

    _toSvg(clientX, clientY) {
      const r = this.root.getBoundingClientRect(), v = this.vb;
      // preserveAspectRatio meet: figure out the real scale & offset
      const s = Math.min(r.width / v.w, r.height / v.h);
      const ox = (r.width - v.w * s) / 2, oy = (r.height - v.h * s) / 2;
      return [v.x + (clientX - r.left - ox) / s, v.y + (clientY - r.top - oy) / s, s];
    }

    _bindEvents() {
      const root = this.root, pts = new Map();
      let startPan = null, pinch = null;

      root.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = this._toSvg(e.clientX, e.clientY);
        this.zoomBy(Math.exp(-e.deltaY * 0.0018), x, y, false);
      }, { passive: false });

      root.addEventListener('pointerdown', (e) => {
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        this.dragMoved = false;
        if (pts.size === 1) {
          const [, , s] = this._toSvg(e.clientX, e.clientY);
          startPan = { cx: e.clientX, cy: e.clientY, vx: this.vb.x, vy: this.vb.y, s };
        } else if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
          startPan = null;
        }
      });
      window.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const [x, y] = this._toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          if (pinch.d > 0) this.zoomBy(d / pinch.d, x, y, false);
          pinch.d = d; this.dragMoved = true;
        } else if (startPan && pts.size === 1) {
          const dx = e.clientX - startPan.cx, dy = e.clientY - startPan.cy;
          if (!this.dragMoved && Math.hypot(dx, dy) < 6) return;
          this.dragMoved = true;
          root.classList.add('dragging');
          this.setView({ x: startPan.vx - dx / startPan.s, y: startPan.vy - dy / startPan.s, w: this.vb.w, h: this.vb.h }, false);
        }
      });
      const up = (e) => {
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
        if (pts.size === 0) { startPan = null; root.classList.remove('dragging'); }
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);

      root.addEventListener('click', (e) => {
        if (this.dragMoved) { this.dragMoved = false; return; }
        const mk = e.target.closest('[data-marker]');
        if (mk) { this.emit('marker', this.markers.find((m) => m.g === mk.closest('.marker'))?.item); return; }
        const p = e.target.closest('path.pref');
        if (p) this.emit('pref', +p.dataset.id);
        else this.emit('sea');
      });
      root.addEventListener('mouseover', (e) => {
        const mk = e.target.closest('.marker');
        const p = e.target.closest('path.pref');
        if (mk) this.emit('hover', { marker: this.markers.find((m) => m.g === mk)?.item });
        else if (p) this.emit('hover', { pref: +p.dataset.id });
        else this.emit('hover', null);
      });
      root.addEventListener('mouseleave', () => this.emit('hover', null));
    }

    // ---------- pref styling ----------
    clearPrefs() {
      Object.values(this.paths).forEach((p) => {
        p.setAttribute('class', 'pref');
        p.style.removeProperty('--fill');
      });
    }
    setPrefFill(id, color) { this.paths[id].style.setProperty('--fill', color); }
    addClass(ids, cls) { [].concat(ids).forEach((id) => this.paths[id].classList.add(cls)); }
    removeClass(ids, cls) { [].concat(ids).forEach((id) => this.paths[id].classList.remove(cls)); }
    setInteractive(on) { this.root.classList.toggle('interactive', on); }

    colorByRegion(on) {
      D.regions.forEach((r) => r.prefs.forEach((id) => {
        if (on) this.setPrefFill(id, r.color); else this.paths[id].style.removeProperty('--fill');
      }));
    }

    prefBox(ids) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      [].concat(ids).forEach((id) => {
        const b = this.paths[id].getBBox();
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      });
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    // ---------- markers ----------
    clearMarkers() {
      this.markerLayer.textContent = '';
      this.markers = [];
    }

    // kind: 'city' | 'landmark'
    addMarker(item, kind) {
      const [x, y] = project(item.lat, item.lon);
      const g = svg('g', { class: `marker ${kind}` }, this.markerLayer);
      svg('circle', { class: 'hit', r: 16, 'data-marker': 1 }, g);
      if (kind === 'city') svg('circle', { class: 'dot', r: 6 }, g);
      else svg('path', { class: 'dot', d: 'M0,-9 L7,0 L0,9 L-7,0Z' }, g);
      const t = svg('text', { class: 'mlabel', x: 10, y: 4 }, g);
      t.textContent = item.ja;
      const m = { g, x, y, item, kind };
      this.markers.push(m);
      g.setAttribute('transform', `translate(${x} ${y}) scale(${this._inv()})`);
      return m;
    }
    markerOf(item) { return this.markers.find((m) => m.item === item); }
    setMarkerClass(item, cls, on = true) { const m = this.markerOf(item); if (m) m.g.classList.toggle(cls, on); }
    pos(item) { return project(item.lat, item.lon); }

    // ---------- text labels (study mode) ----------
    clearLabels() { this.labelLayer.textContent = ''; this.labels = []; }
    addLabel(x, y, text, cls) {
      const g = svg('g', { class: 'label ' + (cls || '') }, this.labelLayer);
      const t = svg('text', { x: 0, y: 0 }, g);
      t.textContent = text;
      const l = { g, x, y };
      this.labels.push(l);
      g.setAttribute('transform', `translate(${x} ${y}) scale(${this._inv()})`);
      return l;
    }

    // ---------- effects ----------
    clearFx() { this.fxLayer.textContent = ''; }
    addRing(x, y, cls) {
      const g = svg('g', { 'data-fx': 1, 'data-x': x, 'data-y': y, class: 'fx-ring ' + (cls || '') }, this.fxLayer);
      svg('circle', { r: 26 }, g);
      g.setAttribute('transform', `translate(${x} ${y}) scale(${this._inv()})`);
      return g;
    }
  }

  window.MapView = MapView;
  window.projectLatLon = project;
})();
