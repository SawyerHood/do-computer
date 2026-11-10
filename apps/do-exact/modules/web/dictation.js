// Browser-only microphone access; Contract owns the draft, buttons and server request.
import { watch } from './shared.js';

export function create(element, initial, event) {
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{display:block;color:inherit}.mic{width:100%;height:100%;display:grid;place-items:center;border-radius:50%;cursor:pointer}.mic:hover{background:color-mix(in srgb,currentColor 7%,transparent)}svg{width:20px;height:20px}canvas{display:block;width:100%;height:100%}canvas[hidden]{display:none}';
  const box = document.createElement('div'); box.className = 'mic';
  box.innerHTML = '<svg viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round"><rect x="88" y="24" width="80" height="136" rx="40"/><path d="M56 120v8a72 72 0 0 0 144 0v-8M128 200v32M96 232h64"/></svg>';
  const canvas = document.createElement('canvas'); canvas.hidden = true;
  root.replaceChildren(style, box, canvas);
  let props = {}, serial = '', take = 0, state = 'idle', destroyed = false;
  let reply = '';
  let recorder, stream, audio, source, analyser, samples, bars = [], last = -1e9;
  const tell = value => { if (!destroyed) event(8, value); };
  const setState = value => { state = value; box.style.display = value === 'idle' ? 'grid' : 'none'; canvas.hidden = value === 'idle'; tell(`state:${value}`); draw(); };
  function release() {
    stream?.getTracks().forEach(track => track.stop()); stream = undefined;
    source?.disconnect(); analyser?.disconnect(); source = analyser = undefined;
    void audio?.close(); audio = undefined;
  }
  function cancel() { take++; tell('cancelled'); if (recorder?.state === 'recording') recorder.stop(); recorder = undefined; release(); setState('idle'); }
  function draw() {
    if (state === 'idle') return;
    const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight), dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = getComputedStyle(element).color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const count = Math.floor(width / 5), values = bars.length < count ? [...Array(count - bars.length).fill(.06), ...bars] : bars;
    for (let i = 0; i < Math.min(count, values.length); i++) {
      const x = width - 1.5 - i * 5, half = values[values.length - 1 - i] * 14;
      ctx.globalAlpha = Math.min(1, Math.max(.15, x / (width * .15)));
      ctx.beginPath(); ctx.moveTo(x, height / 2 - half); ctx.lineTo(x, height / 2 + half); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  let starting = false;
  async function start() {
    if (state !== 'idle' || starting) return;
    starting = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { starting = false; return tell(JSON.stringify({ error: 'This browser does not support dictation.' })); }
    const mine = ++take;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true }); starting = false;
      if (mine !== take || destroyed) { microphone.getTracks().forEach(t => t.stop()); return; }
      stream = microphone;
      const active = new MediaRecorder(microphone), chunks = []; recorder = active;
      let end = 'draft';
      active.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      active.onstop = async () => {
        release(); if (mine !== take || destroyed) return;
        const blob = new Blob(chunks, { type: active.mimeType });
        if (blob.size === 0) return setState('idle');
        setState('transcribing');
        const reader = new FileReader();
        reader.onload = () => { if (mine !== take || destroyed) return; tell(JSON.stringify({ audio: String(reader.result).split(',')[1], type: active.mimeType, end })); };
        reader.onerror = () => { tell(JSON.stringify({ error: 'The recording could not be read.' })); setState('idle'); };
        reader.readAsDataURL(blob);
      };
      active.finish = value => { end = value; if (active.state === 'recording') active.stop(); };
      if (typeof AudioContext !== 'undefined') {
        audio = new AudioContext(); void audio.resume();
        source = audio.createMediaStreamSource(microphone); analyser = audio.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser); samples = new Uint8Array(analyser.fftSize);
      }
      bars = []; active.start(); setState('recording');
    } catch { starting = false; release(); tell(JSON.stringify({ error: 'The microphone is not available. Check the browser’s permission for this site.' })); setState('idle'); }
  }
  const stopFrames = watch({ frame(_seconds, now) {
    if (state !== 'recording' || now - last < 66 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    last = now;
    let rms = 0;
    if (analyser && samples) { analyser.getByteTimeDomainData(samples); for (const n of samples) rms += ((n - 128) / 128) ** 2; rms = Math.sqrt(rms / samples.length); }
    bars.push(Math.max(.06, Math.min(1, (Math.max(0, rms - .006) * 8) ** .6)));
    if (bars.length > Math.ceil(element.clientWidth / 5)) bars.shift(); draw();
  }, destroy() { handle.destroy(); } });
  const resize = new ResizeObserver(draw); resize.observe(element);
  const handle = {
    setProps(next) {
      if (props['chat-key'] !== undefined && props['chat-key'] !== next['chat-key']) cancel();
      props = next;
      if (reply !== '' && reply !== next.reply && state === 'transcribing') setState('idle');
      reply = next.reply;
      if (next.serial !== serial) {
        serial = next.serial;
        if (next.directive === 'start') void start();
        else if (next.directive === 'cancel') cancel();
        else if (next.directive === 'draft' || next.directive === 'send') recorder?.finish(next.directive);
      }
    },
    destroy() { if (destroyed) return; destroyed = true; cancel(); stopFrames(); resize.disconnect(); root.replaceChildren(); },
  };
  handle.setProps(initial); event(7); return handle;
}
