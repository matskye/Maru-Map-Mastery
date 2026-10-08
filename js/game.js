// Maru's Map Mastery - game logic
(function () {
  const D = window.QUIZ_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  const bi = (ja, en) => `<span class="ja">${ja}</span><span class="en">${en}</span>`;
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- storage (always guarded: may be unavailable) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('maru:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('maru:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    clear() { try { Object.keys(localStorage).filter((k) => k.startsWith('maru:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ } },
  };
  let stats = store.get('stats', {});     // "kind:id" -> {r, w}
  let best = store.get('best', {});       // mode -> best score
  const settings = Object.assign({ kana: true, en: true, dir: 'mix' }, store.get('settings', {}));

  // ---------- content lookups ----------
  const LISTS = { region: D.regions, pref: D.prefs, city: D.cities, landmark: D.landmarks };
  const NOUN = {
    region: ['ちほう', 'region'], pref: ['とどうふけん', 'prefecture'],
    city: ['まち', 'city'], landmark: ['めいしょ', 'landmark'],
  };
  const prefById = (id) => D.prefs.find((p) => p.id === id);
  const regionById = (id) => D.regions.find((r) => r.id === id);
  const regionOfPref = (id) => D.regions.find((r) => r.prefs.includes(id));
  const keyOf = (kind, item) => kind + ':' + item.id;
  const isMarker = (kind) => kind === 'city' || kind === 'landmark';
  const sameText = (item) => item.kana === item.ja;

  function dist(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- modes ----------
  const MODES = [
    { id: 'region', icon: '🗾', ja: '地方', en: 'Regions', sub: ['8つのちほう', '8 regions'] },
    { id: 'pref', icon: '📍', ja: '都道府県', en: 'Prefectures', sub: ['47のけん', '47 prefectures'] },
    { id: 'city', icon: '🏙️', ja: '都市', en: 'Cities', sub: [`${D.cities.length}のまち`, `${D.cities.length} cities`] },
    { id: 'landmark', icon: '⛩️', ja: '名所', en: 'Landmarks', sub: [`${D.landmarks.length}のばしょ`, `${D.landmarks.length} sights`] },
    { id: 'all', icon: '🎲', ja: 'ぜんぶ', en: 'Everything', sub: ['ぜんぶまぜる', 'A bit of everything'] },
    { id: 'weak', icon: '💪', ja: 'にがて', en: 'Weak spots', sub: ['まちがえたもの', 'Things you missed'] },
  ];
  const DIRS = [
    { id: 'find', ja: 'ちずでさがす', en: 'Find it on the map' },
    { id: 'name', ja: 'なまえをこたえる', en: 'Name what is shown' },
    { id: 'mix', ja: 'まぜる', en: 'Mix of both' },
  ];

  function weakKeys() {
    return Object.keys(stats).filter((k) => stats[k].w > stats[k].r);
  }
  function lookupKey(k) {
    const [kind, id] = k.split(':');
    const item = LISTS[kind] && LISTS[kind].find((x) => String(x.id) === id);
    return item ? { kind, item } : null;
  }

  function candidates(mode) {
    const of = (kind) => LISTS[kind].map((item) => ({ kind, item }));
    if (mode === 'all') return [].concat(of('region'), of('pref'), of('city'), of('landmark'));
    if (mode === 'weak') return weakKeys().map(lookupKey).filter(Boolean);
    return of(mode);
  }

  function weightedPick(cands, n) {
    const pool = cands.map((c) => {
      const s = stats[keyOf(c.kind, c.item)] || { r: 0, w: 0 };
      // more weight for things missed, less for things known well
      let w = 1 + 3 * s.w / (1 + s.r) + (s.r + s.w === 0 ? 0.5 : 0);
      if (mode_all && c.kind === 'region') w *= 0.4;
      return { c, w };
    });
    const out = [];
    while (out.length < n && pool.length) {
      const total = pool.reduce((a, b) => a + b.w, 0);
      let r = Math.random() * total, idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      out.push(pool.splice(idx, 1)[0].c);
    }
    return out;
  }
  let mode_all = false;

  // ---------- state ----------
  const G = { mode: null, dir: settings.dir, qs: [], i: 0, score: 0, streak: 0, correct: 0, locked: true, missed: [], active: false };
  const gameMap = new MapView($('#mapWrapGame'));
  const studyMap = new MapView($('#mapWrapStudy'));

  // ---------- screens ----------
  function show(name) {
    ['menu', 'game', 'result', 'study'].forEach((s) => $('#screen-' + s).classList.toggle('hidden', s !== name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
  }

  // ---------- menu ----------
  function renderMenu() {
    const wrap = $('#modeCards');
    wrap.innerHTML = '';
    MODES.forEach((m) => {
      const n = candidates(m.id).length;
      const disabled = n === 0;
      const b = document.createElement('button');
      b.className = 'card' + (disabled ? ' disabled' : '');
      b.disabled = disabled;
      const bestTxt = best[m.id] != null ? `<span class="best">★ ${best[m.id]}</span>` : '';
      const sub = m.id === 'weak' ? [`${n}こ`, `${n} item${n === 1 ? '' : 's'}`] : m.sub;
      b.innerHTML = `<span class="card-icon">${m.icon}</span>
        <span class="card-title">${m.ja}<span class="en">${m.en}</span></span>
        <span class="card-sub">${bi(sub[0], sub[1])}</span>${bestTxt}`;
      b.addEventListener('click', () => startGame(m.id));
      wrap.appendChild(b);
    });
    const seg = $('#dirSeg');
    seg.innerHTML = '';
    DIRS.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (settings.dir === d.id ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', settings.dir === d.id);
      b.innerHTML = bi(d.ja, d.en);
      b.addEventListener('click', () => { settings.dir = d.id; store.set('settings', settings); renderMenu(); });
      seg.appendChild(b);
    });
  }

  // ---------- game flow ----------
  function startGame(mode) {
    mode_all = mode === 'all';
    const cands = candidates(mode);
    if (!cands.length) return;
    const n = Math.min(10, cands.length);
    const picked = weightedPick(cands, n);
    G.mode = mode;
    G.dir = settings.dir;
    G.qs = picked.map((c) => ({
      kind: c.kind, item: c.item,
      dir: G.dir === 'mix' ? (Math.random() < 0.5 ? 'find' : 'name') : G.dir,
    }));
    Object.assign(G, { i: 0, score: 0, streak: 0, correct: 0, missed: [], active: true });
    show('game');
    gameMap.resetView(false);
    nextQuestion();
  }

  function nextQuestion() {
    if (G.i >= G.qs.length) return finish();
    const q = G.qs[G.i];
    G.locked = false;
    $('#feedback').classList.add('hidden');
    $('#btnNext').classList.add('hidden');
    $('#choices').innerHTML = '';
    setMaru('happy');
    updateHud();

    gameMap.clearPrefs(); gameMap.clearMarkers(); gameMap.clearFx();
    gameMap.setInteractive(false);

    const [nj, ne] = NOUN[q.kind];
    const it = q.item;
    const target = `<div class="q-target"><span class="big">${it.ja}</span>` +
      (sameText(it) ? '' : `<span class="kana">${it.kana}</span>`) +
      `<span class="en">${it.en}</span></div>`;

    if (q.dir === 'find') {
      if (q.kind === 'region') gameMap.colorByRegion(true);
      if (isMarker(q.kind)) {
        LISTS[q.kind].forEach((x) => gameMap.addMarker(x, q.kind));
        gameMap.resetView(true);
      } else gameMap.resetView(true);
      gameMap.setInteractive(true);
      const tapWhat = isMarker(q.kind)
        ? ['しるしをタップしてね。', 'Tap its marker on the map.']
        : ['ちずをタップしてね。', 'Tap it on the map.'];
      $('#bubble').innerHTML = `<div class="q-instr">${bi(`この${nj}はどこ？ ${tapWhat[0]}`, `Where is this ${ne}? ${tapWhat[1]}`)}</div>${target}`;
    } else {
      let choices;
      if (q.kind === 'region') {
        gameMap.colorByRegion(false);
        const ids = regionById(it.id).prefs;
        gameMap.addClass(ids, 'target');
        const c = gameMap.centroid[ids[0]];
        gameMap.resetView(true);
        choices = pickChoices(q);
      } else if (q.kind === 'pref') {
        gameMap.addClass(it.id, 'target');
        const [cx, cy] = gameMap.centroid[it.id];
        gameMap.addRing(cx, cy, 'target');
        gameMap.resetView(true);
        choices = pickChoices(q);
      } else {
        const m = gameMap.addMarker(it, q.kind);
        m.g.classList.add('target');
        gameMap.addRing(m.x, m.y, 'target');
        gameMap.focusOn(m.x, m.y, 2.4, true);
        choices = pickChoices(q);
      }
      $('#bubble').innerHTML = `<div class="q-instr">${bi(`ひかっている${nj}の なまえは？`, `What is the name of the glowing ${ne}?`)}</div>`;
      renderChoices(q, choices);
    }
  }

  function pickChoices(q) {
    const list = LISTS[q.kind].filter((x) => x !== q.item);
    let others;
    if (q.kind === 'region') others = shuffle(list).slice(0, 3);
    else if (q.kind === 'pref') {
      const near = shuffle(list.filter((p) => p.region === q.item.region));
      const far = shuffle(list.filter((p) => p.region !== q.item.region));
      others = near.slice(0, 2).concat(far).slice(0, 3);
    } else {
      const byDist = list.slice().sort((a, b) => dist(q.item, a) - dist(q.item, b));
      const close = byDist.slice(0, 5);
      const pickClose = shuffle(close).slice(0, 2);
      const rest = shuffle(list.filter((x) => !pickClose.includes(x)));
      others = pickClose.concat(rest).slice(0, 3);
    }
    return shuffle([q.item].concat(others));
  }

  function renderChoices(q, choices) {
    const box = $('#choices');
    box.innerHTML = '';
    choices.forEach((c, idx) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.dataset.idx = idx;
      b.innerHTML = `<kbd>${idx + 1}</kbd><span class="c-main"><span class="c-ja">${c.ja}</span>` +
        (sameText(c) ? '' : `<span class="kana c-kana">${c.kana}</span>`) + `</span>`;
      b.addEventListener('click', () => {
        if (G.locked) return;
        resolve(q, c === q.item, { choice: c, button: b, buttons: [...box.children], choices });
      });
      box.appendChild(b);
    });
  }

  // map clicks while a "find" question is active
  gameMap.on('pref', (id) => {
    if (!G.active || G.locked) return;
    const q = G.qs[G.i];
    if (q.dir !== 'find') return;
    if (q.kind === 'region') {
      const picked = regionOfPref(id);
      resolve(q, picked.id === q.item.id, { pickedRegion: picked });
    } else if (q.kind === 'pref') {
      resolve(q, id === q.item.id, { pickedPref: id });
    }
  });
  gameMap.on('marker', (item) => {
    if (!G.active || G.locked || !item) return;
    const q = G.qs[G.i];
    if (q.dir !== 'find' || !isMarker(q.kind)) return;
    resolve(q, item === q.item, { pickedItem: item });
  });

  function resolve(q, correct, info) {
    G.locked = true;
    gameMap.setInteractive(false);
    const key = keyOf(q.kind, q.item);
    stats[key] = stats[key] || { r: 0, w: 0 };
    if (correct) {
      stats[key].r++; G.correct++;
      G.score += 10 + Math.min(G.streak, 5) * 2;
      G.streak++;
    } else {
      stats[key].w++; G.streak = 0; G.missed.push(q);
    }
    store.set('stats', stats);

    // --- reveal on the map / choices
    const it = q.item;
    if (q.dir === 'find') {
      if (q.kind === 'region') {
        gameMap.addClass(regionById(it.id).prefs, 'ok');
        if (!correct) gameMap.addClass(info.pickedRegion.prefs, 'bad');
      } else if (q.kind === 'pref') {
        gameMap.addClass(it.id, 'ok');
        if (!correct) gameMap.addClass(info.pickedPref, 'bad');
        const [cx, cy] = gameMap.centroid[it.id];
        gameMap.addRing(cx, cy, 'ok');
      } else {
        gameMap.markers.forEach((m) => { if (m.item !== it && m.item !== info.pickedItem) m.g.classList.add('faded'); });
        gameMap.setMarkerClass(it, 'ok');
        const [x, y] = gameMap.pos(it);
        gameMap.addRing(x, y, 'ok');
        if (!correct) gameMap.setMarkerClass(info.pickedItem, 'bad');
        gameMap.ensureVisible(x, y);
      }
    } else {
      gameMap.removeClass(Object.keys(gameMap.paths), 'target');
      if (q.kind === 'region') gameMap.addClass(regionById(it.id).prefs, 'ok');
      else if (q.kind === 'pref') gameMap.addClass(it.id, 'ok');
      else gameMap.setMarkerClass(it, 'ok');
      gameMap.markers.forEach((m) => m.g.classList.remove('target'));
      info.buttons.forEach((b, i) => {
        b.disabled = true;
        if (info.choices[i] === it) b.classList.add('ok');
      });
      if (!correct) info.button.classList.add('bad');
    }

    // --- Maru + feedback
    setMaru(correct ? 'happy' : 'sad', true);
    $('#bubble').innerHTML = correct
      ? `<div class="react ok">${bi('せいかい！', 'Correct!')}</div>`
      : `<div class="react bad">${bi('ざんねん…', 'Not quite…')}</div>`;
    const fb = $('#feedback');
    fb.className = 'feedback ' + (correct ? 'ok' : 'bad');
    fb.innerHTML = answerCard(q, correct);
    $('#btnNext').classList.remove('hidden');
    $('#btnNext').innerHTML = G.i === G.qs.length - 1 ? bi('けっかをみる ▶', 'See results') : bi('つぎへ ▶', 'Next');
    $('#btnNext').focus({ preventScroll: true });
    updateHud();
  }

  function answerCard(q, correct) {
    const it = q.item;
    const [nj, ne] = NOUN[q.kind];
    let h = `<div class="ans-head">${correct ? '' : `<span class="ans-label">${bi('こたえ', 'Answer')}</span>`}
      <span class="ans-ja">${it.ja}</span>${sameText(it) ? '' : `<span class="kana ans-kana">${it.kana}</span>`}
      <span class="en ans-en">${it.en}</span></div>`;
    if (q.kind === 'pref') {
      const r = regionOfPref(it.id);
      h += `<div class="ans-note">${bi(`${r.ja}ちほうの${nj}`, `A prefecture in the ${r.en} region`)}</div>`;
    } else if (q.kind === 'region') {
      h += `<div class="ans-note">${bi(it.prefs.length === 1 ? '1つのけん' : `${it.prefs.length}のけん`, `${it.prefs.length} prefecture${it.prefs.length === 1 ? '' : 's'}: ` + it.prefs.map((id) => prefById(id).en).join(', '))}</div>`;
    } else {
      const p = prefById(it.pref);
      h += `<div class="ans-note">📍 ${bi(`${p.ja}（${p.kana}）にあります`, `Located in ${p.en}`)}</div>`;
      h += `<div class="ans-note dim"><span class="en">${it.note}</span></div>`;
    }
    return h;
  }

  function setMaru(mood, animate) {
    const img = $('#maruImg');
    img.src = `assets/maru-${mood}.svg`;
    img.classList.remove('bounce', 'shake');
    if (animate) { void img.offsetWidth; img.classList.add(mood === 'happy' ? 'bounce' : 'shake'); }
  }

  function updateHud() {
    $('#hudQ').textContent = `${Math.min(G.i + 1, G.qs.length)}/${G.qs.length}`;
    $('#hudScore').textContent = G.score;
    $('#hudStreak').textContent = G.streak > 1 ? `🔥${G.streak}` : G.streak;
    $('#progressBar').style.width = `${(G.i + (G.locked ? 1 : 0)) / G.qs.length * 100}%`;
  }

  $('#btnNext').addEventListener('click', () => {
    if (!G.locked) return;
    G.i++;
    nextQuestion();
  });

  function finish() {
    G.active = false;
    const n = G.qs.length, pct = G.correct / n;
    if (G.mode !== 'weak' && (best[G.mode] == null || G.score > best[G.mode])) { best[G.mode] = G.score; store.set('best', best); }
    const happy = pct >= 0.6;
    $('#resultMaru').src = `assets/maru-${happy ? 'happy' : 'sad'}.svg`;
    $('#resultMaru').className = 'result-maru ' + (happy ? 'bounce' : 'shake');
    const title = pct === 1 ? ['かんぺき！ちずマスター！', 'Perfect! Map Master!']
      : pct >= 0.8 ? ['すごい！', 'Amazing!']
      : pct >= 0.6 ? ['いいね！', 'Nice work!']
      : pct >= 0.3 ? ['もうすこし！', 'Almost there!']
      : ['がんばろう！', 'Keep going!'];
    $('#resultTitle').innerHTML = bi(title[0], title[1]);
    $('#resultScore').textContent = G.score;
    $('#resultOf').innerHTML = bi('てん', 'points');
    $('#resultStats').innerHTML = `<span>${bi('せいかい', 'Correct')}<b>${G.correct}/${n}</b></span>`;
    const missed = $('#resultMissed');
    if (G.missed.length) {
      missed.innerHTML = `<h3 class="section-title tight">${bi('ふくしゅう', 'Review')}</h3><ul class="missed">` +
        G.missed.map((q) => `<li><span class="m-ja">${q.item.ja}</span> ${sameText(q.item) ? '' : `<span class="kana m-kana">${q.item.kana}</span>`} <span class="en m-en">${q.item.en}</span></li>`).join('') + '</ul>';
    } else missed.innerHTML = '';
    $('#btnWeak').style.display = weakKeys().length ? '' : 'none';
    show('result');
  }

  $('#btnAgain').addEventListener('click', () => startGame(G.mode === 'weak' && !weakKeys().length ? 'all' : G.mode));
  $('#btnWeak').addEventListener('click', () => startGame('weak'));
  $('#btnMenu').addEventListener('click', toMenu);
  $('#btnQuit').addEventListener('click', toMenu);
  $('#brand').addEventListener('click', toMenu);
  function toMenu() { G.active = false; renderMenu(); show('menu'); }

  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'game' || e.target.closest('input')) return;
    if (/^[1-4]$/.test(e.key) && !G.locked) {
      const b = $('#choices').children[+e.key - 1]; if (b) b.click();
    } else if ((e.key === 'Enter' || e.key === ' ') && G.locked && !$('#btnNext').classList.contains('hidden')) {
      e.preventDefault(); $('#btnNext').click();
    }
  });

  // ---------- study mode ----------
  const layers = { region: true, city: false, landmark: false };
  function startStudy() {
    show('study');
    studyMap.resetView(false);
    renderStudy();
    $('#studyInfo').innerHTML = `<div class="study-empty">${bi('ちずのばしょをタップしてね。', 'Tap a place on the map.')}</div>`;
  }
  function renderStudy() {
    studyMap.clearPrefs(); studyMap.clearMarkers(); studyMap.clearLabels(); studyMap.clearFx();
    studyMap.setInteractive(true);
    studyMap.colorByRegion(layers.region);
    D.regions.forEach((r) => {
      const ids = r.prefs.filter((id) => id !== 47);
      const cx = ids.reduce((a, id) => a + studyMap.centroid[id][0], 0) / ids.length;
      const cy = ids.reduce((a, id) => a + studyMap.centroid[id][1], 0) / ids.length;
      studyMap.addLabel(cx, cy, r.ja.replace('・沖縄', ''), 'region');
    });
    D.prefs.forEach((p) => {
      const [cx, cy] = studyMap.centroid[p.id];
      studyMap.addLabel(cx, cy, p.ja.replace(/[県府都]$/, ''), 'pref');
    });
    if (layers.city) D.cities.forEach((c) => studyMap.addMarker(c, 'city'));
    if (layers.landmark) D.landmarks.forEach((c) => studyMap.addMarker(c, 'landmark'));
    const chips = $('#layerChips');
    chips.innerHTML = '';
    [['region', '🎨', 'ちほうのいろ', 'Region colours'], ['city', '🏙️', 'とし', 'Cities'], ['landmark', '⛩️', 'めいしょ', 'Landmarks']].forEach(([k, ic, ja, en]) => {
      const b = document.createElement('button');
      b.className = 'chip' + (layers[k] ? ' on' : '');
      b.innerHTML = `${ic} ${bi(ja, en)}`;
      b.addEventListener('click', () => { layers[k] = !layers[k]; renderStudy(); });
      chips.appendChild(b);
    });
  }
  function infoRow(item, kind) {
    return `<li data-kind="${kind}" data-id="${item.id}"><b>${item.ja}</b> <span class="kana">${item.kana}</span> <span class="en">${item.en}</span></li>`;
  }
  function showPrefInfo(id) {
    const p = prefById(id), r = regionOfPref(id);
    studyMap.clearFx();
    studyMap.paths && Object.values(studyMap.paths).forEach((x) => x.classList.remove('sel'));
    studyMap.addClass(id, 'sel');
    const cities = D.cities.filter((c) => c.pref === id), lms = D.landmarks.filter((c) => c.pref === id);
    $('#studyInfo').innerHTML = `
      <div class="info-card">
        <div class="info-ja">${p.ja}</div>
        <div class="kana info-kana">${p.kana}</div>
        <div class="en info-en">${p.en}</div>
        <div class="info-region">${bi(`${r.ja}（${r.kana}）ちほう`, `${r.en} region`)}</div>
        ${cities.length ? `<h4>🏙️ ${bi('とし', 'Cities')}</h4><ul>${cities.map((c) => infoRow(c, 'city')).join('')}</ul>` : ''}
        ${lms.length ? `<h4>⛩️ ${bi('めいしょ', 'Landmarks')}</h4><ul>${lms.map((c) => infoRow(c, 'landmark')).join('')}</ul>` : ''}
      </div>`;
  }
  function showMarkerInfo(item) {
    const kind = studyMap.markerOf(item).kind, p = prefById(item.pref);
    Object.values(studyMap.paths).forEach((x) => x.classList.remove('sel'));
    studyMap.clearFx();
    const [x, y] = studyMap.pos(item);
    studyMap.addRing(x, y, 'ok');
    studyMap.focusOn(x, y, Math.max(studyMap.zoom, 2.4));
    $('#studyInfo').innerHTML = `
      <div class="info-card">
        <div class="info-ja">${item.ja}</div>
        <div class="kana info-kana">${item.kana}</div>
        <div class="en info-en">${item.en}</div>
        <div class="info-region">📍 ${bi(`${p.ja}（${p.kana}）`, p.en)}</div>
        <p class="info-note en">${item.note}</p>
      </div>`;
  }
  studyMap.on('pref', showPrefInfo);
  studyMap.on('marker', (item) => item && showMarkerInfo(item));
  $('#studyInfo').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const kind = li.dataset.kind;
    const item = LISTS[kind].find((x) => String(x.id) === li.dataset.id);
    layers[kind] = true;
    renderStudy();
    showMarkerInfo(item);
  });

  $('#btnStudy').addEventListener('click', startStudy);

  // ---------- options ----------
  function applySettings() {
    document.body.classList.toggle('show-kana', settings.kana);
    document.body.classList.toggle('show-en', settings.en);
    $('#optKana').checked = settings.kana;
    $('#optEn').checked = settings.en;
  }
  $('#optKana').addEventListener('change', (e) => { settings.kana = e.target.checked; store.set('settings', settings); applySettings(); });
  $('#optEn').addEventListener('change', (e) => { settings.en = e.target.checked; store.set('settings', settings); applySettings(); });
  $('#btnReset').addEventListener('click', () => {
    if (confirm('きろくをぜんぶけしますか？\nReset all progress and best scores?')) {
      store.clear(); stats = {}; best = {}; renderMenu();
    }
  });

  applySettings();
  renderMenu();
  show('menu');
  window.__maru = { G, gameMap, studyMap, startGame, resolve };   // handy for debugging
})();
