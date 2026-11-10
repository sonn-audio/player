#!/usr/bin/env node
/*
 * The page, measured.
 *
 * Screenshots are read by eye, and an eye misses a chip that is five pixels too small for a thumb or a row
 * that runs two pixels past its frame. This opens the player in a headless Chrome at a width, walks the
 * screens you name, and says what the hand and the frame would notice:
 *
 *  - overflow: something wider than the window, or a page that scrolls sideways;
 *  - tap: on a phone width, a control whose reach is under 44px (measured by hit-testing around its
 *    centre, so a pill that looks 34px and reaches 44px passes);
 *  - clipped: text cut by its box without an ellipsis to say so.
 *
 * usage: node tools/check.mjs [--url http://localhost:5175/player/] [--width 390] [--click sel]... [--eval js]...
 * Exit 1 when anything is found. Needs Chrome at /Applications or CHROME_PATH.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
let url = 'http://localhost:5175/player/';
let width = 1440;
let wait = 6000;
const clicks = [];
const evals = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--url') url = args[++i];
  else if (args[i] === '--width') width = Number(args[++i]);
  else if (args[i] === '--wait') wait = Number(args[++i]);
  else if (args[i] === '--click') clicks.push(args[++i]);
  else if (args[i] === '--eval') evals.push(args[++i]);
}
const height = width < 600 ? 844 : 900;
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9500 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'sonn-check-'));
const chrome = spawn(
  chromePath,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    wsUrl = list.find((target) => target.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
if (!wsUrl) {
  chrome.kill();
  throw new Error('Chrome did not come up');
}
const ws = new WebSocket(wsUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return reply.result?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(wait);
for (const selector of clicks) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  await sleep(1200);
}
for (const js of evals) {
  await evaluate(js);
  await sleep(1200);
}

const findings = await evaluate(`(() => {
  const out = [];
  const W = window.innerWidth;
  const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + (el.textContent ? ' “' + el.textContent.trim().slice(0, 24) + '”' : ''));
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.bottom > 0 && r.top < window.innerHeight; };

  if (document.documentElement.scrollWidth > W + 1) out.push({ kind: 'overflow', where: 'page', note: 'scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W });
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.right > W + 1 && cs.position !== 'fixed') {
      let p = el.parentElement, clipped = false;
      while (p) { const pcs = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(pcs.overflowX) || pcs.maskImage !== 'none') { clipped = true; break; } p = p.parentElement; }
      if (!clipped) out.push({ kind: 'overflow', where: name(el), note: 'right edge at ' + Math.round(r.right) + 'px of ' + W });
    }
    if (/(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.whiteSpace === 'nowrap' && el.children.length === 0 && el.textContent.trim()) {
      out.push({ kind: 'clipped', where: name(el), note: el.scrollWidth + 'px of text in ' + el.clientWidth + 'px' });
    }
  }

  if (W < 600) {
    const MIN = 44;
    for (const el of document.querySelectorAll('button, a[href], [role=button], input[type=range]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      /* Off the screen, or under a sheet: not this screen's control. */
      if (cx < 0 || cx >= W || cy < 0 || cy >= window.innerHeight) continue;
      const at = document.elementFromPoint(cx, cy);
      if (!at || !(at === el || el.contains(at))) continue;
      /* A probe past the screen's edge passes: the edge is the easiest target there is. */
      const hits = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= window.innerHeight) return true; const t = document.elementFromPoint(x, y); return t && (t === el || el.contains(t)); };
      const reachW = (hits(cx - MIN / 2 + 1, cy) && hits(cx + MIN / 2 - 1, cy)) ? MIN : r.width;
      const reachH = (hits(cx, cy - MIN / 2 + 1) && hits(cx, cy + MIN / 2 - 1)) ? MIN : r.height;
      const inText = el.closest('p, .cx-empty-note, .cx-deskpage-note, .cx-align-note, .cx-rooms-note');
      if ((reachW < MIN || reachH < MIN) && !inText) out.push({ kind: 'tap', where: name(el), note: Math.round(reachW) + '×' + Math.round(reachH) + 'px' });
    }
  }
  return out;
})()`);

ws.close();
chrome.kill();

const label = `${width}px${clicks.length ? ' after ' + clicks.join(' → ') : ''}`;
if (!findings || findings.length === 0) {
  console.log(`ok · ${label}`);
  process.exit(0);
}
console.log(`${findings.length} finding${findings.length === 1 ? '' : 's'} · ${label}`);
for (const finding of findings) {
  console.log(`  ${finding.kind.padEnd(8)} ${finding.where}  —  ${finding.note}`);
}
process.exit(1);
