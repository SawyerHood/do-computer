// The window's call. The data module alone holds the session and makes authenticated writes.
import { createCaller, callClock, callPhaseWords, EMPTY_CHAT, reduceChat, digest } from './call-core.js';
import { openLine, microphoneProblem } from './call-media.js';
import { watch } from './shared.js';

export function create(element, initial, event) {
  let gone = false, props = {}, serial = '', response = '', count = 0, clock = '', media, pendingMedia;
  const waiting = new Map();
  const say = word => { if (!gone) event(8, word); };
  const ask = (agentId, verb, body = {}, callId = '') => new Promise((resolve, reject) => {
    const id = String(++count);
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('The server did not answer. Try calling again.')); }, 25000);
    waiting.set(id, { resolve, reject, timer });
    say('rpc:' + JSON.stringify({ id, agentId, verb, body, callId }));
  });
  function follow(agentId, chatId, changed) {
    let closed = false, socket, retry, ping, state = EMPTY_CHAT;
    const connect = async () => {
      try {
        const { address } = await ask(agentId, 'socket');
        if (closed) return;
        socket = new WebSocket(address);
        const send = value => { if (socket.readyState === 1) socket.send(JSON.stringify(value)); };
        socket.onopen = () => { send({ type: 'follow', chat: chatId }); ping = setInterval(() => { if (socket.readyState === 1) socket.send('{"t":"ping"}'); }, 30000); };
        socket.onmessage = ({ data }) => {
          let message; try { message = JSON.parse(data); } catch { return; }
          if (message.type === 'chat' && message.chat === chatId) { state = reduceChat(state, message.event); changed(state); }
          if (message.type === 'resumed' && message.chats[chatId] !== digest(state)) send({ type: 'follow', chat: chatId });
        };
        socket.onclose = () => { clearInterval(ping); if (!closed) retry = setTimeout(connect, 1000); };
        socket.onerror = () => socket.close();
      } catch { if (!closed) retry = setTimeout(connect, 1000); }
    };
    void connect();
    return () => { closed = true; clearTimeout(retry); clearInterval(ping); socket?.close(); };
  }
  const caller = createCaller({
    agent: agentId => ({ calls: () => ask(agentId, 'calls'), startCall: body => ask(agentId, 'start', body), callSaid: (id, lines) => ask(agentId, 'lines', { lines }, id), callWork: (id, body) => ask(agentId, 'work', body, id), endCall: (id, lines = []) => ask(agentId, 'end', { lines }, id) }),
    openLine: async (place, onEvent, onLost) => {
      const controller = new AbortController(); pendingMedia = controller;
      let placed;
      const abort = () => { if (placed) void ask(props.agent, 'end', { lines: [] }, placed.id).catch(() => {}); };
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        const opened = await openLine(async offer => {
          placed = await place(offer);
          if (controller.signal.aborted) { abort(); throw new DOMException('The call ended.', 'AbortError'); }
          return placed;
        }, onEvent, onLost, controller.signal);
        media = opened.line; return opened;
      } finally { controller.signal.removeEventListener('abort', abort); if (pendingMedia === controller) pendingMedia = undefined; }
    },
    microphoneProblem, follow,
  });
  const publish = () => {
    const { call, problem, wrapUp } = caller.getState();
    clock = callClock(call?.startedAt, Date.now());
    say('view:' + JSON.stringify({ active: !!call, agentId: call?.agentId ?? '', chatId: call?.chatId ?? '', name: call?.agentName ?? '', phase: call?.phase ?? '', status: call ? callPhaseWords(call) : '', clock, muted: call?.muted ?? false, lines: call?.lines ?? [], you: call?.you ?? '', dood: call?.dood ?? '', works: call?.works ?? [], problem: problem?.text ?? '', wrapAgentId: wrapUp?.agentId ?? '', wrapChatId: wrapUp?.chatId ?? '', wrapCallId: wrapUp?.callId ?? '' }));
  };
  const unsubscribe = caller.subscribe(publish);
  // A little waveform: microphone and remote stream levels, not invented audio.
  const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>:host{display:block}canvas{width:100%;height:100%;display:block}</style><canvas aria-hidden="true"></canvas>';
  const canvas = root.querySelector('canvas');
  let bars = [], sampled = -Infinity;
  const stop = watch({ frame(_dt, now) {
    const call = caller.getState().call;
    if (!call) return;
    const next = callClock(call.startedAt, Date.now()); if (clock !== next) publish();
    const levels = media?.levels() ?? { you: 0, dood: 0 };
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    canvas.width = Math.max(1, element.clientWidth); canvas.height = Math.max(1, element.clientHeight);
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = getComputedStyle(element).color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const level = Math.max(call.muted ? 0 : levels.you, levels.dood);
    if (now - sampled >= 66) { sampled = now; bars.push(Math.max(.06, Math.min(1, (Math.max(0, level / 3 - .006) * 8) ** .6))); if (bars.length > Math.ceil(canvas.width / 5)) bars.shift(); }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < Math.floor(canvas.width / 5); i++) { const half = (reduced ? .06 : bars[bars.length - 1 - i] ?? .06) * canvas.height * .45; const x = canvas.width - 1.5 - i * 5; ctx.globalAlpha = Math.min(1, Math.max(.15, x / (canvas.width * .15))); ctx.beginPath(); ctx.moveTo(x, canvas.height / 2 - half); ctx.lineTo(x, canvas.height / 2 + half); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }, destroy() { handle.destroy(); } });
  const leaving = () => {
    const left = caller.leaving();
    if (left) {
      // Cookie deployment: keepalive survives unloading. Cross-origin Exact also emits its
      // authenticated end request, but teardown may beat that callback.
      void fetch(`${props.address}/api/agents/${encodeURIComponent(left.agentId)}/calls/${encodeURIComponent(left.callId)}/end`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: left.lines }) }).catch(() => {});
    }
    void caller.end(); pendingMedia?.abort(); media?.close();
  };
  window.addEventListener('pagehide', leaving);
  const handle = {
    setProps(next) {
      const previous = props; props = next;
      if (previous.owner && previous.owner !== next.owner) { void caller.end(); pendingMedia?.abort(); media?.close(); }
      if (next.response && response !== next.response) {
        response = next.response;
        let r; try { r = JSON.parse(response); } catch { r = {}; }
        const pending = waiting.get(r.id);
        if (pending) { waiting.delete(r.id); clearTimeout(pending.timer); if (r.ok) pending.resolve(r.body); else pending.reject(Object.assign(new Error(r.error), { status: r.status })); }
      }
      if (serial === next.serial) return;
      serial = next.serial;
      if (next.directive === 'start') void caller.start({ id: next.agent, name: next["dood-name"] }, next.chat);
      if (next.directive === 'mute') caller.setMuted(!caller.getState().call?.muted);
      if (next.directive === 'end') { void caller.end(); pendingMedia?.abort(); media?.close(); }
      if (next.directive === 'clear') caller.clearProblem();
      if (next.directive === 'recorded') caller.clearWrapUp();
    },
    destroy() { if (gone) return; leaving(); gone = true; unsubscribe(); stop(); window.removeEventListener('pagehide', leaving); for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(new Error('The page closed.')); } waiting.clear(); root.replaceChildren(); },
  };
  handle.setProps(initial); event(7); return handle;
}
