'use strict';

const Theme = (() => {
  const KEY = 'speed-clock-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  const stored = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  };

  const system = () => (media && media.matches ? 'dark' : 'light');
  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  const updateLabel = () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const text = `Switch to ${current() === 'dark' ? 'light' : 'dark'} mode`;
    button.setAttribute('aria-label', text);
    button.title = text;
  };

  const apply = (theme) => {
    root.dataset.theme = theme;
    updateLabel();
  };

  apply(stored() || system());

  if (media && media.addEventListener) {
    media.addEventListener('change', () => {
      if (!stored()) apply(system());
    });
  }

  return {
    updateLabel,
    toggle() {
      const next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    },
  };
})();

function startApp() {
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  const el = {
    themeToggle: $('theme-toggle'),
    clock: $('analog-clock'),
    hourHand: $('hour-hand'),
    minuteHand: $('minute-hand'),
    secondHand: $('second-hand'),
    digitalTime: $('digital-time'),
    timeMain: $('time-main'),
    timePeriod: $('time-period'),
    date: $('date-text'),
    timezone: $('timezone-text'),
    speed: $('speed-value'),
    readingLabel: $('reading-label'),
    goButton: $('go-button'),
    goLabel: $('go-label'),
    status: $('test-status'),
    errorBox: $('test-error'),
    errorMessage: $('error-message'),
  };

  Theme.updateLabel();
  el.themeToggle.addEventListener('click', Theme.toggle);

  const TIME_ZONE_ALIASES = {
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Asia/Rangoon': 'Asia/Yangon',
    'Europe/Kiev': 'Europe/Kyiv',
  };

  let lastMinute = '';
  let clockTimer = null;

  function timeZoneName(now) {
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {}
    if (zone) return TIME_ZONE_ALIASES[zone] || zone;
    const offset = -now.getTimezoneOffset();
    const abs = Math.abs(offset);
    return `UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  function fullDate(now) {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .formatToParts(now)
      .forEach((part) => { parts[part.type] = part.value; });
    return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
  }

  function rotate(hand, degrees) {
    hand.style.transform = `translateX(-50%) rotate(${degrees}deg)`;
  }

  function tick() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    rotate(el.hourHand, (h % 12) * 30 + m * 0.5 + s / 120);
    rotate(el.minuteHand, m * 6 + s * 0.1);
    rotate(el.secondHand, s * 6);

    const hour12 = h % 12 || 12;
    const period = h < 12 ? 'AM' : 'PM';
    el.timeMain.textContent = `${pad(hour12)}:${pad(m)}:${pad(s)}`;
    el.timePeriod.textContent = period;
    el.digitalTime.dateTime = `${pad(h)}:${pad(m)}:${pad(s)}`;

    const minuteKey = `${now.toDateString()} ${h}:${m}`;
    if (minuteKey !== lastMinute) {
      lastMinute = minuteKey;
      el.date.textContent = fullDate(now);
      el.date.dateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      el.timezone.textContent = timeZoneName(now);
      el.clock.setAttribute('aria-label', `Analog clock showing ${hour12}:${pad(m)} ${period}`);
    }
  }

  function runClock() {
    try {
      tick();
    } catch (err) {
      console.error(err);
    }
    clockTimer = setTimeout(runClock, 1000 - (Date.now() % 1000) + 5);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clearTimeout(clockTimer);
      runClock();
    }
  });

  runClock();

  const LOCATE_URL = 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7';
  const DOWNLOAD_KEY = 'wss:///ndt/v7/download';
  const PROTOCOL = 'net.measurementlab.ndt.v7';
  const CLIENT_PARAMS = 'client_name=speed-and-time&client_version=1.0';
  const MAX_SERVERS = 3;
  const LOCATE_TIMEOUT_MS = 8000;
  const CONNECT_TIMEOUT_MS = 6000;
  const FIRST_DATA_TIMEOUT_MS = 6000;
  const SAMPLE_MS = 200;
  const WINDOW_MS = 2000;
  const WARMUP_MS = 1000;
  const MIN_TEST_MS = 4000;
  const MAX_TEST_MS = 10000;
  const STALL_MS = 5000;

  const OFFLINE_MESSAGE = 'Your device appears to be offline. Reconnect to the internet and try again.';
  const BUSY_MESSAGE = 'Too many speed tests have been run from your connection recently. Wait a few minutes and try again.';
  const CONNECT_MESSAGE = 'Could not connect to a speed-test server. It may be blocked by your network, a firewall or a browser extension.';
  const NO_RESULT_MESSAGE = 'The test could not get a reliable measurement. Please try again.';

  let test = null;

  function toMbps(bytes, ms) {
    const mbps = (bytes * 8) / (ms / 1000) / 1e6;
    return Number.isFinite(mbps) && mbps > 0 ? mbps : null;
  }

  function formatMbps(mbps) {
    if (mbps === null) return '—';
    if (mbps < 1) return mbps.toFixed(2);
    const oneDecimal = mbps.toFixed(1);
    return Number(oneDecimal) < 100 ? oneDecimal : String(Math.round(mbps));
  }

  function showSpeed(mbps, live = false) {
    el.speed.textContent = formatMbps(mbps);
    el.speed.classList.toggle('is-live', live && mbps !== null);
    el.speed.classList.toggle('is-empty', mbps === null);
    el.speed.parentElement.classList.toggle('is-empty', mbps === null);
  }

  function setStatus(text, isError = false) {
    el.status.textContent = text;
    el.status.classList.toggle('is-error', isError);
  }

  function setButton(label, running) {
    el.goLabel.textContent = label;
    el.goButton.disabled = running;
    el.goButton.classList.toggle('is-running', running);
    el.goButton.classList.toggle('is-small', label.length > 2);
    el.goButton.setAttribute('aria-busy', String(running));
    el.goButton.setAttribute('aria-label', running ? 'Speed test in progress' : label === 'GO' ? 'Start speed test' : 'Run the speed test again');
  }

  function showError(message) {
    el.errorMessage.textContent = message;
    el.errorBox.hidden = false;
  }

  function hideError() {
    el.errorMessage.textContent = '';
    el.errorBox.hidden = true;
  }

  function showFailure(message) {
    showSpeed(null);
    el.readingLabel.textContent = 'Test failed';
    setStatus('Test failed', true);
    showError(message);
    setButton('RETRY', false);
  }

  function closeSocket(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000);
      } catch {}
    }
  }

  function stop(t) {
    t.done = true;
    clearInterval(t.timer);
    t.controller.abort();
    closeSocket(t.ws);
    if (test === t) test = null;
  }

  function fail(t, message) {
    if (t.done) return;
    stop(t);
    showFailure(message);
  }

  function complete(t) {
    if (t.done) return;
    const result = t.warm ? toMbps(t.bytes - t.warm.bytes, performance.now() - t.warm.time) : null;
    if (result === null) {
      fail(t, NO_RESULT_MESSAGE);
      return;
    }
    stop(t);
    showSpeed(result);
    el.readingLabel.textContent = 'This is your ISP capacity';
    setStatus('Test completed');
    setButton('RETEST', false);
  }

  async function findServers(t) {
    const timer = setTimeout(() => t.controller.abort(), LOCATE_TIMEOUT_MS);
    try {
      const response = await fetch(`${LOCATE_URL}?${CLIENT_PARAMS}`, { cache: 'no-store', signal: t.controller.signal });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      const data = await response.json();
      return (data.results || [])
        .map((result) => result.urls && result.urls[DOWNLOAD_KEY])
        .filter(Boolean)
        .slice(0, MAX_SERVERS)
        .map((url) => `${url}${url.includes('?') ? '&' : '?'}${CLIENT_PARAMS}`);
    } finally {
      clearTimeout(timer);
    }
  }

  function connect(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url, PROTOCOL);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        closeSocket(ws);
        reject(new Error('Connection timed out'));
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.onopen = ws.onerror = null;
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        closeSocket(ws);
        reject(new Error('Connection failed'));
      };
    });
  }

  function liveSpeed(t, now) {
    const from = now - WINDOW_MS;
    const start = t.samples.find((sample) => sample.time >= from) || t.samples[0];
    return start ? toMbps(t.bytes - start.bytes, now - start.time) : null;
  }

  function isStable(history) {
    if (history.length < 6) return false;
    const recent = history.slice(-6);
    const avg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    return recent.every((v) => Math.abs(v - avg) / avg < 0.03);
  }

  function sample(t) {
    if (t.done) return;
    const now = performance.now();

    if (t.firstData === null) {
      if (t.bytes > 0) {
        t.firstData = now;
        t.samples.push({ time: now, bytes: t.bytes });
      } else if (now - t.start > FIRST_DATA_TIMEOUT_MS) {
        fail(t, CONNECT_MESSAGE);
      }
      return;
    }

    if (now - t.lastData > STALL_MS) {
      fail(t, 'The connection stopped responding during the test.');
      return;
    }

    const running = now - t.firstData;
    if (!t.warm && running >= WARMUP_MS) t.warm = { time: now, bytes: t.bytes };

    const live = liveSpeed(t, now);
    t.samples.push({ time: now, bytes: t.bytes });
    if (live !== null) {
      showSpeed(live, true);
      if (t.warm) t.history.push(live);
    }

    if (running >= MAX_TEST_MS || (running >= MIN_TEST_MS && isStable(t.history))) complete(t);
  }

  function measure(t) {
    t.start = performance.now();
    t.lastData = t.start;
    t.ws.onmessage = (event) => {
      if (t.done || typeof event.data === 'string') return;
      t.bytes += event.data.byteLength;
      t.lastData = performance.now();
    };
    t.ws.onclose = () => complete(t);
    t.ws.onerror = () => complete(t);
    setStatus('Testing your speed...');
    t.timer = setInterval(() => sample(t), SAMPLE_MS);
  }

  async function startTest() {
    if (test) return;
    hideError();
    showSpeed(null);
    el.readingLabel.textContent = 'wait nigg*';

    if (!navigator.onLine) {
      showFailure(OFFLINE_MESSAGE);
      return;
    }

    const t = {
      controller: new AbortController(),
      ws: null,
      done: false,
      timer: null,
      start: 0,
      firstData: null,
      lastData: 0,
      bytes: 0,
      samples: [],
      history: [],
      warm: null,
    };
    test = t;
    setButton('GO', true);
    setStatus('Finding the nearest server...');

    let servers;
    try {
      servers = await findServers(t);
    } catch (err) {
      if (!t.done) fail(t, !navigator.onLine ? OFFLINE_MESSAGE : err.status === 429 ? BUSY_MESSAGE : CONNECT_MESSAGE);
      return;
    }
    if (t.done) return;
    if (!servers.length) {
      fail(t, CONNECT_MESSAGE);
      return;
    }

    setStatus('Connecting...');
    for (const url of servers) {
      try {
        const ws = await connect(url);
        if (t.done) {
          closeSocket(ws);
          return;
        }
        t.ws = ws;
        break;
      } catch {
        if (t.done) return;
      }
    }

    if (!t.ws) {
      fail(t, CONNECT_MESSAGE);
      return;
    }
    measure(t);
  }

  showSpeed(null);
  setStatus('Press GO to measure your connection.');
  el.goButton.addEventListener('click', startTest);

  window.addEventListener('offline', () => {
    if (test) fail(test, OFFLINE_MESSAGE);
  });

  window.addEventListener('pagehide', () => {
    if (test) fail(test, 'The test was interrupted. Press RETRY to run it again.');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}