  // ==========================
  // Utilidades & Estado
  // ==========================
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const fmt = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

  const STORAGE_KEY = 'neon-slots-v1';
  const initState = () => ({
    balance: 100,   // saldo inicial
    bet: 1,
    sound: true,
    auto: false,
  });
  let state = loadState();
  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return initState();
      const data = JSON.parse(raw);
      return { ...initState(), ...data };
    }catch(e){ return initState(); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  // ==========================
  // Áudio (WebAudio sem assets externos)
  // ==========================
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let masterGain = ctx.createGain();
  masterGain.gain.value = 0.6; masterGain.connect(ctx.destination);

  function beep(type='sine', freq=440, dur=0.08, vol=0.3){
    if(!state.sound) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(masterGain);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.stop(ctx.currentTime + dur);
  }
  function spinSound(){ // som de rolagem com ruído
    if(!state.sound) return {stop:()=>{}};
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i] = Math.random()*2-1; // ruído branco
    noise.buffer = buffer; noise.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=800;
    const g = ctx.createGain(); g.gain.value=0.08;
    noise.connect(filter); filter.connect(g); g.connect(masterGain);
    noise.start();
    return { stop: ()=>{ try{ g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2); noise.stop(ctx.currentTime+0.21);}catch(e){} } };
  }

  // ==========================
  // Slot Machine
  // ==========================
  const SYMBOLS = ['🍒','🔔','🍀','⭐','💎'];
  const PAY = {
    '💎💎💎': 25,
    '⭐⭐⭐': 10,
    '🍀🍀🍀': 7,
    '🍒🍒🍒': 5,
    '🔔🔔🔔': 3,
  };

  const reelsEl = $('#reels');
  const REEL_COUNT = 3;
  const VISIBLE = 3; // linhas visíveis (usamos apenas a central para payout)
  const CELL_H = 70; // definido no CSS

  // cria carretéis e tiras
  const reels = [];
  for(let r=0;r<REEL_COUNT;r++){
    const reel = document.createElement('div');
    reel.className='reel';
    const strip = document.createElement('div');
    strip.className='strip';
    reel.appendChild(strip);
    reelsEl.appendChild(reel);
    reels.push({ reel, strip, pos:0, symbols:[] });
  }

  function buildStrip(symbols){
    // duplica símbolos para criar uma faixa longa, garantindo rolagem contínua
    const sequence = [];
    for(let i=0;i<8;i++) sequence.push(...symbols);
    return sequence;
  }

  function renderReel(r){
    const data = reels[r];
    data.strip.innerHTML = '';
    data.symbols = buildStrip(SYMBOLS);
    data.symbols.forEach(sym=>{
      const s = document.createElement('div');
      s.className='symbol'; s.textContent = sym;
      data.strip.appendChild(s);
    });
    data.height = data.symbols.length * CELL_H;
    setStripY(r, data.pos);
  }

  function setStripY(r, y){
    const data = reels[r];
    // usa mod para looping
    data.pos = y % data.height;
    data.strip.style.transform = `translateY(${-data.pos}px)`;
  }

  for(let r=0;r<REEL_COUNT;r++) renderReel(r);

  // ==========================
  // UI de Apostas / Saldo
  // ==========================
  const balanceEl = $('#balance');
  const betEl = $('#bet');
  const chipsEl = $('#chips');
  const toastsEl = $('#toasts');
  const tickerEl = $('#ticker');

  const CHIP_VALUES = [1,2,5,10,20,50];
  function renderChips(){
    chipsEl.innerHTML = '';
    CHIP_VALUES.forEach(v=>{
      const b = document.createElement('button');
      b.className = 'chip' + (state.bet===v ? ' active':'' );
      b.textContent = `R$ ${v}`;
      b.onclick = ()=>{ state.bet = v; saveState(); updateUI(); beep('triangle', 660, .05, .15) };
      chipsEl.appendChild(b);
    });
  }
  function updateUI(){
    balanceEl.textContent = fmt(state.balance);
    betEl.textContent = fmt(state.bet);
    renderChips();
    $('#btn-sound span').textContent = state.sound? 'ON':'OFF';
  }
  updateUI();

  // ==========================
  // Mecânica de Giro
  // ==========================
  let spinning = false;
  let autoTimer = null;

  function spinOnce(){
    if(spinning) return;
    if(state.balance < state.bet){ toast('Saldo insuficiente. Deposite para continuar.', 'warn'); beep('sawtooth', 140, .1, .2); return; }

    state.balance -= state.bet; saveState(); updateUI();

    const spin = spinSound();
    spinning = true; $('#btn-spin').disabled = true;

    // destino pseudo-aleatório por carretel
    const targets = Array.from({length:REEL_COUNT}, ()=> Math.floor(Math.random()*SYMBOLS.length));

    // tempos diferentes para cada carretel
    const durations = [1200, 1600, 2000];
    const easings = t=>1- Math.pow(1-t, 3); // easeOutCubic

    const start = performance.now();

    const startPos = reels.map((d)=>d.pos);

    function step(now){
      const elapsed = now - start;
      let allDone = true;

      for(let i=0;i<REEL_COUNT;i++){
        const d = reels[i];
        const T = durations[i];
        const t = Math.min(1, elapsed / T);
        const e = easings(t);

        // rolagem rápida + desaceleração
        const spins = 6 + i; // volta mínima
        const base = startPos[i] + spins * d.height * e;

        // alinhamento do alvo
        const targetIndexOnStrip = d.symbols.findIndex(s=>s===SYMBOLS[targets[i]]);
        const targetY = targetIndexOnStrip * CELL_H;
        const final = (base + targetY) % d.height;

        setStripY(i, final);

        if(t < 1) allDone = false; else if(!d._stopped){
          d._stopped = true;
          beep('triangle', 520 - i*60, .05, .25);
        }
      }

      if(!allDone){ requestAnimationFrame(step); }
      else {
        spin.stop();
        setTimeout(()=>{
          reels.forEach(r=>r._stopped=false);
          onResult(targets);
          spinning = false; $('#btn-spin').disabled = false;
          if(state.auto){ autoSpinSchedule(); }
        }, 80);
      }
    }
    requestAnimationFrame(step);
  }

  function onResult(targets){
    // usa a linha central (índice 1) — como todos alinham igual, pegamos os próprios alvos
    const line = targets.map(i=>SYMBOLS[i]);
    const key = line.join('');

    let mult = PAY[key] || 0;
    if(mult===0){
      // verifica 2 iguais
      const set = new Set(line);
      if(set.size===2) mult = 1; // qualquer 2 iguais
    }

    if(mult>0){
      const win = state.bet * mult;
      state.balance += win; saveState(); updateUI();
      flashWin(line);
      toast(`Você ganhou ${fmt(win)} (×${mult})!`, 'win');
      celebrate();
      beep('sine', 880, .12, .35); setTimeout(()=>beep('sine', 1040, .12, .35), 90);
    } else {
      toast('Sem prêmio desta vez. Tente novamente!', 'info');
    }
    updateTicker(line, mult);
  }

  function flashWin(line){
    // marca as três células visíveis onde a linha passa; como é uma lista em loop, apenas aplica highlight às 3 posições centrais
    for(let i=0;i<REEL_COUNT;i++){
      const d = reels[i];
      const idx = Math.round(d.pos / CELL_H) % d.symbols.length; // símbolo no topo
      const centerIdx = (idx + 1) % d.symbols.length; // linha central
      const cells = $$('.symbol', d.strip);
      cells[centerIdx]?.classList.add('win');
      setTimeout(()=>cells[centerIdx]?.classList.remove('win'), 1000);
    }
  }

  function updateTicker(line, mult){
    tickerEl.innerHTML = `Resultado: <b>${line.join(' ')}</b> ${mult>0?`• Pagou ×${mult}`:'• Sem prêmio'}`;
  }

  function toast(msg, type='info'){
    const el = document.createElement('div');
    el.className='toast';
    el.textContent = msg;
    if(type==='win') el.style.borderLeftColor = 'var(--accent-3)';
    if(type==='warn') el.style.borderLeftColor = 'var(--danger)';
    toastsEl.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(-6px)'; }, 2200);
    setTimeout(()=> el.remove(), 2700);
  }

  function celebrate(){
    // chuva de confetes simples em canvas (sem libs externas)
    const cvs = document.createElement('canvas');
    Object.assign(cvs.style,{position:'fixed', inset:0, pointerEvents:'none'});
    const ctx2 = cvs.getContext('2d');
    const W = cvs.width = innerWidth; const H = cvs.height = innerHeight;
    document.body.appendChild(cvs);
    const parts = Array.from({length:120}, (_,i)=>({
      x: Math.random()*W,
      y: -10 - Math.random()*H*0.3,
      r: 2+Math.random()*4,
      s: 1+Math.random()*2.5,
      a: Math.random()*Math.PI*2,
    }));
    let t0 = performance.now();
    function draw(t){
      const dt = Math.min(32, t - t0); t0 = t;
      ctx2.clearRect(0,0,W,H);
      parts.forEach(p=>{
        p.y += p.s * dt/16; p.x += Math.sin(p.a + t/200) * 0.6;
        ctx2.globalAlpha = .9;
        ctx2.fillStyle = ['#5cffc7','#7aa2ff','#ffd36a','#ff9ca0'][Math.floor(Math.random()*4)];
        ctx2.beginPath(); ctx2.arc(p.x,p.y,p.r,0,Math.PI*2); ctx2.fill();
      });
      if(parts.some(p=>p.y < H+6)) requestAnimationFrame(draw); else cvs.remove();
    }
    requestAnimationFrame(draw);
  }

  // ==========================
  // Controles / Botões
  // ==========================
  $('#btn-spin').onclick = ()=> spinOnce();
  $('#btn-max').onclick = ()=>{ state.bet = Math.min(Math.max(...CHIP_VALUES), state.balance||Math.max(...CHIP_VALUES)); saveState(); updateUI(); beep('square', 520, .06, .2) };
  $('#btn-auto').onclick = ()=>{ state.auto = !state.auto; saveState(); updateUI(); $('#btn-auto').textContent = state.auto? '⏸️ PARAR':'▶️ AUTO'; if(state.auto && !spinning) autoSpinSchedule(); };
  $('#btn-deposit').onclick = ()=>{
    const v = +prompt('Quanto deseja depositar? (apenas número, em R$)', '100');
    if(!isNaN(v) && v>0){ state.balance += Math.floor(v); saveState(); updateUI(); toast(`Depósito de ${fmt(v)} realizado.`, 'info'); beep('sine', 660, .08, .3) }
  };
  $('#btn-withdraw').onclick = ()=>{
    const v = +prompt('Quanto deseja sacar?', Math.min(state.balance, 50));
    if(!isNaN(v) && v>0 && v<=state.balance){ state.balance -= Math.floor(v); saveState(); updateUI(); toast(`Saque de ${fmt(v)} realizado.`, 'info'); }
  };
  $('#btn-reset').onclick = ()=>{
    if(confirm('Resetar jogo e restaurar valores padrão?')){
      state = initState(); saveState(); updateUI(); toast('Jogo resetado. Boa sorte!', 'info');
    }
  };
  $('#btn-sound').onclick = async ()=>{
    // desbloqueia contexto no primeiro clique em navegadores móveis
    try{ await ctx.resume(); }catch(e){}
    state.sound = !state.sound; saveState(); updateUI();
  };
  $('#btn-help').onclick = ()=>{
    alert(`Como jogar:\n\n1) Escolha a APOSTA nos botões de ficha.\n2) Clique em GIRAR (ou pressione ESPAÇO).\n3) A linha que paga é a HORIZONTAL CENTRAL.\n4) Tabela à direita mostra multiplicadores.\n5) Deposite, saque e use AUTO para rodadas contínuas.\n\nDica: seu saldo e preferências ficam salvos no navegador.`);
  };

  function autoSpinSchedule(){
    clearTimeout(autoTimer);
    if(!state.auto) return;
    autoTimer = setTimeout(()=>{ if(state.balance>=state.bet){ spinOnce(); } else { state.auto=false; updateUI(); toast('AUTO desligado: saldo insuficiente.', 'warn'); } }, 600);
  }

  // teclado
  window.addEventListener('keydown', (e)=>{
    if(e.code==='Space'){ e.preventDefault(); spinOnce(); }
    if(e.code==='KeyA'){ state.auto=!state.auto; updateUI(); $('#btn-auto').click(); }
  });

  // Inicialização visual dos carretéis (posição aleatória agradável)
  reels.forEach((d,i)=> setStripY(i, Math.floor(Math.random()*d.height)));

  // primeira dica sonora discreta
  setTimeout(()=>{ beep('sine', 520, .06, .16) }, 300);

  // ==== Config API ====
const API = {
  base: '/api', // ajuste conforme seu host (ex.: 'http://localhost/cassino/api')
  login: '/login.php',
  state: '/state.php',
  deposit: '/deposit.php',
  withdraw: '/withdraw.php',
  spin: '/spin.php'
};

const storage = {
  set(k,v){ localStorage.setItem(k, JSON.stringify(v)); },
  get(k, fallback=null){ try{ return JSON.parse(localStorage.getItem(k)) ?? fallback }catch(e){ return fallback } },
  del(k){ localStorage.removeItem(k); }
};

let auth = storage.get('auth', null); // {user_id, api_key, username}

async function apiFetch(url, data){
  const res = await fetch(API.base + url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data ?? {})
  });
  if(!res.ok) throw
}