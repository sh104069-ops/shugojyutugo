'use strict';

/* =========================================================
   ユーティリティ
   ルビは {漢字|よみ} と書く
   ========================================================= */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const rubyHtml = s => s.replace(/\{([^|}]+)\|([^}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
const plain    = s => s.replace(/\{([^|}]+)\|([^}]+)\}/g, '$1');

const store = {
  get(key, fallback){
    try{
      const v = localStorage.getItem('shujutsu:' + key);
      return v === null ? fallback : JSON.parse(v);
    }catch(e){ return fallback; }
  },
  set(key, value){
    try{ localStorage.setItem('shujutsu:' + key, JSON.stringify(value)); }catch(e){}
  }
};

/* ---------- おと ---------- */
let audioCtx = null;
let soundOn = store.get('sound', true);

function playSeq(notes){
  if(!soundOn) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    notes.forEach(([freq, start, dur]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    });
  }catch(e){}
}
const sfx = {
  tap:   () => playSeq([[520, 0, .07]]),
  ok:    () => playSeq([[660, 0, .12], [880, .1, .18]]),
  ng:    () => playSeq([[240, 0, .2]]),
  clear: () => playSeq([[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .3]])
};

const soundBtn = $('#soundBtn');
function renderSoundBtn(){
  soundBtn.textContent = soundOn ? '🔊' : '🔇';
  soundBtn.classList.toggle('off', !soundOn);
}
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('sound', soundOn);
  renderSoundBtn();
  if(soundOn) sfx.tap();
});
renderSoundBtn();

/* ---------- よみあげ ---------- */
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
if(!canSpeak) document.body.classList.add('no-speech');

function speak(text){
  if(!canSpeak || !text) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.85;
    speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- 画面のきりかえ ---------- */
function showScreen(name){
  if(canSpeak){ try{ speechSynthesis.cancel(); }catch(e){} }
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  window.scrollTo(0, 0);
}

function go(name){
  if(name === 'bone')        startBone();
  else if(name === 'select') { renderLevels(); showScreen('select'); }
  else if(name === 'build')  startBuild();
  else                       showScreen('home');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go]');
  if(el) go(el.dataset.go);
});

function setMsg(el, kind, html){
  el.className = 'msg ' + kind;
  el.innerHTML = html;
  el.hidden = false;
}

function showResult({face, score, msg, primary, secondary}){
  $('#resultFace').textContent = face;
  $('#resultScore').innerHTML = score;
  $('#resultMsg').innerHTML = msg;
  const p = $('#resultPrimary'), s = $('#resultSecondary');
  p.textContent = primary.label;   p.onclick = primary.fn;
  s.textContent = secondary.label; s.onclick = secondary.fn;
  sfx.clear();
  showScreen('result');
}

/* =========================================================
   ステップ１：たいけん「文のほねをみつけよう」
   S=しゅ語  P=じゅつ語  M=かざりのことば
   ========================================================= */
const BONE = [
  [["あかい","M"], ["とりが","S"], ["ひろい","M"], ["そらを","M"], ["とぶ。","P"]],
  [["きのう、","M"], ["わたしは","S"], ["こうえんで","M"], ["ともだちと","M"], ["あそんだ。","P"]],
  [["{大|おお}きな","M"], ["{犬|いぬ}が","S"], ["げんかんで","M"], ["ぐっすり","M"], ["ねている。","P"]],
  [["この","M"], ["りんごは","S"], ["とても","M"], ["あまい。","P"]],
  [["{妹|いもうと}が","S"], ["だいどころで","M"], ["りょうりを","M"], ["てつだった。","P"]]
];

let bIdx = 0;
let bRemoved = new Set();
let bLock = false;
let bDone = false;
let bTimer = null;

const boneCard = $('#boneCard');
const boneMsg = $('#boneMsg');

function startBone(){
  bIdx = 0;
  loadBone();
  showScreen('bone');
}

function setBoneInstruction(state){
  const box = $('#boneInstruction');
  box.classList.remove('mode-play', 'mode-done');
  if(state === 'done'){
    box.classList.add('mode-done');
    $('#boneBadge').textContent = '✓';
    $('#boneInstructionText').innerHTML = 'これが 文の ほねだ！<small>ほかの ことばを とっても、この 2つは のこるよ</small>';
  }else{
    box.classList.add('mode-play');
    $('#boneBadge').textContent = '🦴';
    $('#boneInstructionText').innerHTML = 'いらない ことばを タップして とってみよう<small>とっても 文の いみが わかるかな？</small>';
  }
}

function loadBone(){
  clearTimeout(bTimer);
  bRemoved = new Set();
  bLock = false;
  bDone = false;
  const q = BONE[bIdx];

  $('#boneCount').textContent = `${bIdx + 1}/${BONE.length}`;
  $('#boneProgress').style.width = `${(bIdx / BONE.length) * 100}%`;

  boneCard.innerHTML = '';
  q.forEach(([text], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chunk';
    b.innerHTML = rubyHtml(text);
    b.addEventListener('click', () => boneTap(i));
    boneCard.appendChild(b);
  });

  $('#boneNext').hidden = true;
  $('#boneNext').textContent = bIdx < BONE.length - 1 ? 'つぎの 文へ →' : 'さいごまで できた！ →';
  setBoneInstruction('play');
  setMsg(boneMsg, 'info', 'ことばを 1つずつ とって、文が どうなるか みてみよう。とった ことばは もう1回 タップすると もどるよ。');
  renderBonePreview();
}

function renderBonePreview(){
  const q = BONE[bIdx];
  const box = $('#bonePreview');
  box.classList.toggle('broken', bLock);
  box.innerHTML = q.map(([text, role], i) => {
    if(!bRemoved.has(i)) return `<span>${rubyHtml(text)}</span>`;
    if(role === 'S') return '<span class="hole">だれが？</span>';
    if(role === 'P') return '<span class="hole">どうする？</span>';
    return '';
  }).join('');
}

function boneChips(){ return $$('.chunk', boneCard); }

function boneTap(i){
  if(bLock || bDone) return;
  const q = BONE[bIdx];
  const chip = boneChips()[i];
  const role = q[i][1];

  // もどす
  if(bRemoved.has(i)){
    bRemoved.delete(i);
    chip.classList.remove('off');
    sfx.tap();
    setMsg(boneMsg, 'info', 'もとに もどしたよ。');
    renderBonePreview();
    return;
  }

  bRemoved.add(i);
  chip.classList.add('off');

  if(role === 'M'){
    const allGone = q.every(([, r], k) => r !== 'M' || bRemoved.has(k));
    if(allGone){ finishBone(); return; }
    sfx.tap();
    setMsg(boneMsg, 'ok', 'とっても 文の いみは わかるね！ ほかの ことばも ためしてみよう。');
    renderBonePreview();
  }else{
    // しゅ語・じゅつ語をとると、文がこわれる → 少しみせてから自動でもどす
    bLock = true;
    sfx.ng();
    chip.classList.add('shake');
    renderBonePreview();
    setMsg(boneMsg, 'warn', role === 'S'
      ? 'あれ？ 「だれが」「なにが」が わからなく なったよ！'
      : 'あれ？ 「どうする」「どんなだ」が わからなく なったよ！');
    bTimer = setTimeout(() => {
      bRemoved.delete(i);
      chip.classList.remove('off', 'shake');
      bLock = false;
      setMsg(boneMsg, 'info', 'これは とると こまる ことばだったね。もとに もどしたよ。');
      renderBonePreview();
    }, 2000);
  }
}

function finishBone(){
  bDone = true;
  const q = BONE[bIdx];
  boneChips().forEach((chip, i) => {
    const role = q[i][1];
    if(role === 'S'){
      chip.classList.add('is-subject', 'has-tag', 'locked');
      chip.insertAdjacentHTML('beforeend', '<span class="tag">しゅ語</span>');
    }else if(role === 'P'){
      chip.classList.add('is-predicate', 'has-tag', 'locked');
      chip.insertAdjacentHTML('beforeend', '<span class="tag">じゅつ語</span>');
    }
  });
  renderBonePreview();
  setBoneInstruction('done');
  setMsg(boneMsg, 'done',
    'のこった 2つが 文の ほね！<br>「だれが」＋「どうする」が あれば 文に なるよ。ほかの ことばは、くわしく するための かざりだよ。');
  $('#boneProgress').style.width = `${((bIdx + 1) / BONE.length) * 100}%`;
  $('#boneNext').hidden = false;
  sfx.clear();
}

function boneText(){
  return BONE[bIdx].filter((_, i) => !bRemoved.has(i)).map(([t]) => plain(t)).join('');
}

$('#boneReset').addEventListener('click', () => { sfx.tap(); loadBone(); });
$('#boneSpeak').addEventListener('click', () => speak(boneText()));
$('#boneNext').addEventListener('click', () => {
  if(bIdx < BONE.length - 1){
    bIdx++;
    loadBone();
  }else{
    showResult({
      face: '🦴',
      score: '文の ほねが わかったね！',
      msg: '文は「だれが」＋「どうする」が ほね。<br>つぎは もんだいで しゅ語と じゅつ語を さがしてみよう。',
      primary:   { label: 'もんだいへ', fn: () => go('select') },
      secondary: { label: 'もういちど たいけん', fn: () => go('bone') }
    });
  }
});

/* =========================================================
   ステップ２：もんだい
   chunks: 文のかたまり  subject / predicate: 正解の位置(0はじまり)
   ========================================================= */
const LEVELS = [
  {
    id: 'lv1',
    name: 'みじかい文',
    desc: '「〇〇が　〇〇。」のかんたんな文',
    questions: [
      { chunks:["あかい","とりが","とぶ。"], subject:1, predicate:2 },
      { chunks:["おとうとが","なく。"], subject:0, predicate:1 },
      { chunks:["せんせいが","わらう。"], subject:0, predicate:1 },
      { chunks:["つよい","かぜが","ふく。"], subject:1, predicate:2 },
      { chunks:["こねこが","ねむる。"], subject:0, predicate:1 },
      { chunks:["おにいさんが","はしる。"], subject:0, predicate:1 },
      { chunks:["しろい","ゆきが","ふる。"], subject:1, predicate:2 },
      { chunks:["おばあさんが","あるく。"], subject:0, predicate:1 }
    ]
  },
  {
    id: 'lv2',
    name: '「〇〇です・だ」の文',
    desc: 'ようすをあらわす じゅつ語の文',
    questions: [
      { chunks:["わたしは","{二年生|にねんせい}です。"], subject:0, predicate:1 },
      { chunks:["この","りんごは","あまい。"], subject:1, predicate:2 },
      { chunks:["きょうは","いい","てんきだ。"], subject:0, predicate:2 },
      { chunks:["たなかさんは","しんせつだ。"], subject:0, predicate:1 },
      { chunks:["そらが","きれいだ。"], subject:0, predicate:1 },
      { chunks:["この","{本|ほん}は","おもしろい。"], subject:1, predicate:2 }
    ]
  },
  {
    id: 'lv3',
    name: 'すこし長い文',
    desc: 'ことばが多い文にちょうせん',
    questions: [
      { chunks:["きのう、","わたしは","こうえんで","あそんだ。"], subject:1, predicate:3 },
      { chunks:["{妹|いもうと}が","だいどころで","りょうりを","てつだった。"], subject:0, predicate:3 },
      { chunks:["{大|おお}きな","{犬|いぬ}が","げんかんで","ねている。"], subject:1, predicate:3 },
      { chunks:["クラスの","みんなが","うんどう会で","がんばった。"], subject:1, predicate:3 }
    ]
  },
  {
    id: 'lv4',
    name: '文しょうよみとり',
    desc: 'みじかいお話の中からさがそう',
    questions: [
      { chunks:["きょう、","たろうくんは","こうえんへ","いきました。"], subject:1, predicate:3 },
      { chunks:["こうえんには","{大|おお}きな","すべりだいが","あります。"], subject:2, predicate:3 },
      { chunks:["たろうくんは","ともだちと","いっしょに","あそびました。"], subject:0, predicate:3 },
      { chunks:["みんなは","とても","たのしそうでした。"], subject:0, predicate:2 }
    ]
  }
];

let curLevel = null;
let qIdx = 0;
let qMode = 'subject';   // subject → predicate → done
let qMistakes = 0;
let qUsedHint = false;
let firstTry = 0;

const sentenceCard = $('#sentenceCard');
const quizMsg = $('#quizMsg');

function renderLevels(){
  const grid = $('#levelGrid');
  const best = store.get('best', {});
  grid.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'level-card';
    const b = best[lv.id];
    const bestHtml = (b !== undefined)
      ? `<div class="level-best">${b >= lv.questions.length ? '⭐ ' : ''}ベスト　${b}/${lv.questions.length}</div>` : '';
    card.innerHTML = `
      <span class="level-tag">レベル${i + 1}</span>
      <div class="level-name">${rubyHtml(lv.name)}</div>
      <div class="level-desc">${lv.desc}（${lv.questions.length}もん）</div>
      ${bestHtml}`;
    card.addEventListener('click', () => startLevel(i));
    grid.appendChild(card);
  });
}

function startLevel(i){
  curLevel = LEVELS[i];
  qIdx = 0;
  firstTry = 0;
  showScreen('quiz');
  loadQuestion();
}

function loadQuestion(){
  const q = curLevel.questions[qIdx];
  qMode = 'subject';
  qMistakes = 0;
  qUsedHint = false;

  $('#qcount').textContent = `${qIdx + 1}/${curLevel.questions.length}`;
  $('#progressBar').style.width = `${(qIdx / curLevel.questions.length) * 100}%`;

  sentenceCard.innerHTML = '';
  q.chunks.forEach((text, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chunk';
    b.innerHTML = rubyHtml(text);
    b.addEventListener('click', () => quizTap(idx));
    sentenceCard.appendChild(b);
  });

  $('#nextBtn').hidden = true;
  $('#boneLine').hidden = true;
  $('#hintBtn').hidden = false;
  quizMsg.hidden = true;
  updateInstruction();
}

function updateInstruction(){
  const box = $('#instructionBox');
  const badge = $('#instructionBadge');
  const text = $('#instructionText');
  box.classList.remove('mode-subject', 'mode-predicate', 'mode-done');

  if(qMode === 'subject'){
    box.classList.add('mode-subject');
    badge.textContent = '①';
    text.innerHTML = '「だれが」「なにが」に あたる ことばを タップしよう<small>しゅ語（主語）をさがします</small>';
  }else if(qMode === 'predicate'){
    box.classList.add('mode-predicate');
    badge.textContent = '②';
    text.innerHTML = '「どうする」「どんなだ」に あたる ことばを タップしよう<small>じゅつ語（述語）をさがします</small>';
  }else{
    box.classList.add('mode-done');
    badge.textContent = '✓';
    text.innerHTML = 'よくできました！<small>「つぎの もんだいへ」をタップしよう</small>';
  }
}

function quizChips(){ return $$('.chunk', sentenceCard); }
function clearHint(){ quizChips().forEach(c => c.classList.remove('hint')); }

function quizTap(idx){
  if(qMode === 'done') return;
  const q = curLevel.questions[qIdx];
  const chip = quizChips()[idx];
  if(chip.classList.contains('locked')) return;
  clearHint();

  if(qMode === 'subject'){
    if(idx === q.subject){
      chip.classList.add('is-subject', 'locked');
      sfx.ok();
      qMode = 'predicate';
      updateInstruction();
      setMsg(quizMsg, 'ok', `「${rubyHtml(q.chunks[idx])}」が しゅ語！<br>つぎは じゅつ語を さがそう。`);
    }else{
      quizWrong(chip, idx === q.predicate
        ? 'それは 「どうする」に あたる ことばだよ。まず 「だれが」「なにが」を さがそう。'
        : 'もういちど かんがえてみよう。「だれが」「なにが」は どれかな？');
    }
  }else if(qMode === 'predicate'){
    if(idx === q.predicate){
      chip.classList.add('is-predicate', 'locked');
      qMode = 'done';
      finishQuestion(q);
    }else{
      quizWrong(chip, 'もういちど かんがえてみよう。「どうする」「どんなだ」は どれかな？');
    }
  }
}

function quizWrong(chip, message){
  qMistakes++;
  sfx.ng();
  chip.classList.add('is-wrong');
  setTimeout(() => chip.classList.remove('is-wrong'), 320);
  setMsg(quizMsg, 'warn', message);
  if(qMistakes >= 3) showHint();
}

function showHint(){
  if(qMode === 'done') return;
  const q = curLevel.questions[qIdx];
  const target = qMode === 'subject' ? q.subject : q.predicate;
  qUsedHint = true;
  clearHint();
  quizChips()[target].classList.add('hint');
  setMsg(quizMsg, 'info', 'ここを タップしてみてね。');
}

function finishQuestion(q){
  const perfect = qMistakes === 0 && !qUsedHint;
  if(perfect) firstTry++;
  sfx.clear();
  updateInstruction();
  $('#progressBar').style.width = `${((qIdx + 1) / curLevel.questions.length) * 100}%`;

  const s = rubyHtml(q.chunks[q.subject]);
  const p = rubyHtml(q.chunks[q.predicate]);
  const line = $('#boneLine');
  line.innerHTML = `<span class="cap">この文の ほね</span><span class="s">${s}</span><span class="arrow">→</span><span class="p">${p}</span>`;
  line.hidden = false;

  setMsg(quizMsg, 'done', perfect
    ? 'さいしょから せいかい！ すごい！<br>「だれが」＋「どうする」が 文の ほねだよ。'
    : 'できたね！ 「だれが」＋「どうする」が 文の ほねだよ。');

  $('#hintBtn').hidden = true;
  const isLast = qIdx >= curLevel.questions.length - 1;
  $('#nextBtn').textContent = isLast ? 'けっかを みる →' : 'つぎの もんだいへ →';
  $('#nextBtn').hidden = false;
}

$('#hintBtn').addEventListener('click', showHint);
$('#quizSpeak').addEventListener('click', () => {
  if(!curLevel) return;
  speak(curLevel.questions[qIdx].chunks.map(plain).join(''));
});
$('#nextBtn').addEventListener('click', () => {
  if(qIdx < curLevel.questions.length - 1){
    qIdx++;
    loadQuestion();
  }else{
    finishLevel();
  }
});

function finishLevel(){
  const total = curLevel.questions.length;
  const best = store.get('best', {});
  if(best[curLevel.id] === undefined || firstTry > best[curLevel.id]){
    best[curLevel.id] = firstTry;
    store.set('best', best);
  }
  let face, msg;
  if(firstTry === total){
    face = '🌸'; msg = 'ぜんもん さいしょから せいかい！　すばらしい！';
  }else if(firstTry >= total * 0.6){
    face = '😊'; msg = 'よく がんばりました！　ぜんぶ クリアしたよ。';
  }else{
    face = '💪'; msg = 'ぜんぶ クリア！　もういちど やると もっと できるよ。';
  }
  showResult({
    face,
    score: `${total}もん中 ${firstTry}もん<br>さいしょから せいかい！`,
    msg,
    primary:   { label: 'もういちど', fn: () => startLevel(LEVELS.indexOf(curLevel)) },
    secondary: { label: 'レベルを えらぶ', fn: () => go('select') }
  });
}

/* =========================================================
   ステップ３：つくろう
   しゅ語とじゅつ語を えらんで文をつくる。
   あわない組みあわせは「へんな文」と気づけるようにする。
   ========================================================= */
const SUBJECTS = [
  { t:'いぬが',       e:'🐶', tags:['animal', 'dog'] },
  { t:'ねこが',       e:'🐱', tags:['animal'] },
  { t:'とりが',       e:'🐦', tags:['animal', 'flyer'] },
  { t:'{先生|せんせい}が', e:'🧑‍🏫', tags:['person'] },
  { t:'おにいさんが', e:'👦', tags:['person'] },
  { t:'はなが',       e:'🌸', tags:['plant'] },
  { t:'くるまが',     e:'🚗', tags:['vehicle'] },
  { t:'ひこうきが',   e:'✈️', tags:['vehicle', 'flyer'] },
  { t:'あめが',       e:'🌧️', tags:['rain'] },
  { t:'ゆきが',       e:'❄️', tags:['rain'] }
];
const PREDICATES = [
  { t:'ほえる。',   need:['dog'] },
  { t:'わらう。',   need:['person'] },
  { t:'なく。',     need:['animal', 'person'] },
  { t:'はしる。',   need:['animal', 'person', 'vehicle'] },
  { t:'とぶ。',     need:['flyer'] },
  { t:'ねむる。',   need:['animal', 'person'] },
  { t:'たべる。',   need:['animal', 'person'] },
  { t:'さく。',     need:['plant'] },
  { t:'ふる。',     need:['rain'] }
];

const fits = (s, p) => p.need.some(n => s.tags.includes(n));
const TOTAL_OK = SUBJECTS.reduce((n, s) => n + PREDICATES.filter(p => fits(s, p)).length, 0);

let selS = null;
let selP = null;
let found = new Set(store.get('found', []));

const buildMsg = $('#buildMsg');
const buildSugg = $('#buildSugg');

function startBuild(){
  selS = null;
  selP = null;
  renderPickRows();
  renderStage();
  renderCollection();
  buildSugg.hidden = true;
  setMsg(buildMsg, 'info', 'しゅ語と じゅつ語を 1つずつ えらんで、文を つくってみよう！');
  showScreen('build');
}

function renderPickRows(){
  const sRow = $('#subjRow'), pRow = $('#predRow');
  sRow.className = 'chip-row subject';
  pRow.className = 'chip-row predicate';
  sRow.innerHTML = '';
  pRow.innerHTML = '';
  SUBJECTS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-chip' + (i === selS ? ' selected' : '');
    b.innerHTML = `<span class="emoji" aria-hidden="true">${s.e}</span><span>${rubyHtml(s.t)}</span>`;
    b.addEventListener('click', () => { selS = i; sfx.tap(); afterPick(); });
    sRow.appendChild(b);
  });
  PREDICATES.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-chip' + (i === selP ? ' selected' : '');
    b.textContent = p.t;
    b.addEventListener('click', () => { selP = i; sfx.tap(); afterPick(); });
    pRow.appendChild(b);
  });
}

function renderStage(state){
  const stage = $('#stage');
  stage.classList.remove('ok', 'ng');
  if(state) stage.classList.add(state);
  const sl = $('#slotS'), pl = $('#slotP');
  if(selS !== null){
    sl.classList.add('filled');
    sl.innerHTML = `<span class="emoji" aria-hidden="true">${SUBJECTS[selS].e}</span><span>${rubyHtml(SUBJECTS[selS].t)}</span>`;
  }else{
    sl.classList.remove('filled');
    sl.textContent = '？';
  }
  if(selP !== null){
    pl.classList.add('filled');
    pl.textContent = PREDICATES[selP].t;
  }else{
    pl.classList.remove('filled');
    pl.textContent = '？';
  }
}

function sentenceOf(si, pi){
  return SUBJECTS[si].t + PREDICATES[pi].t;
}

function afterPick(){
  renderPickRows();
  buildSugg.hidden = true;

  if(selS === null || selP === null){
    renderStage();
    setMsg(buildMsg, 'info', selS === null ? 'つぎは しゅ語を えらぼう。' : 'つぎは じゅつ語を えらぼう。');
    return;
  }

  const s = SUBJECTS[selS], p = PREDICATES[selP];
  const sentenceHtml = rubyHtml(sentenceOf(selS, selP));

  if(fits(s, p)){
    const key = `${selS}-${selP}`;
    const isNew = !found.has(key);
    found.add(key);
    store.set('found', Array.from(found));
    renderStage('ok');
    renderCollection();
    if(found.size >= TOTAL_OK){
      sfx.clear();
      setMsg(buildMsg, 'done', `「${sentenceHtml}」<br>ぜんぶの 文を みつけたよ！ すごい！`);
    }else{
      sfx.ok();
      setMsg(buildMsg, 'ok', `「${sentenceHtml}」<br>文の いみが 通じるね！${isNew ? ' あたらしい 文を みつけた！' : ''}`);
    }
  }else{
    sfx.ng();
    renderStage('ng');
    setMsg(buildMsg, 'warn', `「${sentenceHtml}」<br>うーん、へんな 文に なったよ。<br>「${p.t.replace('。', '')}」のは だれ・なにかな？`);
    showSuggestions();
  }
}

function showSuggestions(){
  const p = PREDICATES[selP];
  buildSugg.innerHTML = '<span class="sugg-label">ヒント：</span>';
  SUBJECTS.forEach((s, i) => {
    if(!fits(s, p)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-chip';
    b.innerHTML = `<span class="emoji" aria-hidden="true">${s.e}</span><span>${rubyHtml(s.t)}</span>`;
    b.addEventListener('click', () => { selS = i; sfx.tap(); afterPick(); });
    buildSugg.appendChild(b);
  });
  buildSugg.hidden = false;
}

function renderCollection(){
  $('#foundCount').textContent = `みつけた 文　${found.size} / ${TOTAL_OK}`;
  const box = $('#collection');
  box.innerHTML = '';
  if(found.size === 0){
    box.innerHTML = '<span class="empty">まだ ありません。通じる 文を つくってみよう！</span>';
    return;
  }
  Array.from(found).forEach(key => {
    const [si, pi] = key.split('-').map(Number);
    if(!SUBJECTS[si] || !PREDICATES[pi]) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'found-chip';
    b.innerHTML = rubyHtml(sentenceOf(si, pi));
    b.addEventListener('click', () => speak(plain(sentenceOf(si, pi))));
    box.appendChild(b);
  });
}

$('#buildRandom').addEventListener('click', () => {
  selS = Math.floor(Math.random() * SUBJECTS.length);
  selP = Math.floor(Math.random() * PREDICATES.length);
  afterPick();
});
$('#buildSpeak').addEventListener('click', () => {
  if(selS === null || selP === null) return;
  speak(plain(sentenceOf(selS, selP)));
});

/* ---------- 起動 ---------- */
showScreen('home');
