// Real-browser tour of the explorer. Starts its OWN fresh, in-memory world on
// GX_PORT (default 8793, never 8790) from a temp root, and stops it after.
// Run (after spikes/guidelines/build.sh): node spikes/guidelines/test/browser.mjs
//   → screenshots in spikes/guidelines/proof/screens/
import { chromium } from '../../browser/node_modules/playwright-core/index.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { spawn } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url)), proof = path.join(here, '../proof/screens');
const port = Number(process.env.GX_PORT || 8793);
if (port === 8790) throw Error('refusing the live world');
const base = 'http://127.0.0.1:' + port;
const world = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-tour-'));
const server = spawn(path.join(here, '../run.sh'), [], { env: { ...process.env, GX_WORLD: world, GX_PORT: String(port), GX_SKIP_BUILD: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let serverLog = ''; server.stdout.on('data', (d) => serverLog += d); server.stderr.on('data', (d) => serverLog += d);
const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', stop);
for (let i = 0; i < 120; i++) { if (await fetch(base + '/').then((r) => r.ok, () => false)) break; if (server.exitCode != null) throw Error('world exited:\n' + serverLog); await new Promise((r) => setTimeout(r, 500)); }
fs.mkdirSync(proof, { recursive: true });
const exe = process.env.GX_CHROMIUM || ['/home/user/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', '/usr/bin/google-chrome-stable'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
const log = []; page.on('console', (m) => { if (m.type() === 'error') log.push(m.text()); }); page.on('pageerror', (e) => log.push(String(e)));
const shot = (n) => page.screenshot({ path: path.join(proof, n) });
const sink = '#sink, textarea, body';
const press = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
const chord = async (s) => { for (const k of s.split(' ')) await press(k === 'space' ? 'Space' : k); await page.waitForTimeout(400); };
const text = () => page.locator('.gx').innerText().catch(() => '');
const results = [];
const check = (name, ok) => { results.push([ok ? 'ok' : 'FAIL', name]); };

await page.goto(base + '/?file=guidelines.bl.org&use=guidelines', { waitUntil: 'load' });
await page.waitForSelector('.gx-row', { timeout: 30000 });
await page.waitForTimeout(600);
check('explorer drawn beside the file', await page.locator('.gx-row').count() === 7);
check('everything starts off', (await text()).includes('all off'));
await shot('01-explorer-all-off.png');

await page.locator('.gx-row', { hasText: "Show, don't label" }).click(); await page.waitForTimeout(400);
check('click selects; detail shows the rule', (await page.locator('.gx-detail h2').innerText()).includes("Show, don't label"));
await page.locator('.gx-switch').click(); await page.waitForTimeout(1500);
check('switch ON rewrites the heading', (await page.locator('.pane.editor').first().innerText()).includes('* ON Show'));
check('the row moves to the on group', (await page.locator('.gx-group').first().innerText()).startsWith('on'));
await shot('02-switched-on.png');

await page.locator('#sink').focus().catch(() => {});
await chord('space g ?'); await page.waitForTimeout(300);
check('guide opens with space g ?', await page.locator('.gx-guide').isVisible());
await shot('03-guide.png');
await chord('space g ?');

await chord('space g j'); await page.waitForTimeout(300);
check('space g j selects the next guideline', !(await page.locator('.gx-detail h2').innerText()).includes("Show, don't label"));

await page.locator('.gx-tab', { hasText: 'Try' }).click(); await page.waitForTimeout(200);
await page.locator('.gx-try input').fill('the failed cards should look different from the done ones');
await page.locator('.gx-try input').press('Enter'); await page.waitForTimeout(1500);
check('try shows meters with the threshold', await page.locator('.gx-meter').count() === 7);
check('the ON rule fires', await page.locator('.gx-meter.fire:not(.off)').count() >= 1);
await shot('04-try.png');

// a task that hits a dialect gap and applies the guideline → the inbox fills
const r = await page.evaluate(async () => (await fetch('/api/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: 'task/open', args: { goal: 'make the blocked task row stand out in the rail' } }) })).json());
check('task opened', r.ok === true);
await page.waitForTimeout(6000);
await page.locator('#sink').focus().catch(() => {});
await chord('space g r'); await page.waitForTimeout(1500);
await page.locator('.gx-tab', { hasText: 'Inbox' }).click(); await page.waitForTimeout(500);
const inboxN = await page.locator('.gx-item').count();
check('inbox has the ready example and the dialect proposal (' + inboxN + ')', inboxN >= 2);
await shot('05-inbox.png');
await page.locator('.gx-item.k-proposed').first().click().catch(() => {}); await page.waitForTimeout(400);
check('dialect proposal shows nearby functions', (await text()).includes('nearby functions'));
await shot('06-inbox-dialect.png');
await page.locator('.gx-item.k-ready').first().click(); await page.waitForTimeout(300);
await page.locator('.gx-btn.primary', { hasText: 'Accept' }).click(); await page.waitForTimeout(2000);
check('accepted example lands in the file', (await page.locator('.pane.editor').first().innerText()).includes('no BLOCKED word (while:'));
await page.locator('.gx-tab', { hasText: 'Guidelines' }).click(); await page.waitForTimeout(300);
await page.locator('.gx-row', { hasText: "Show, don't label" }).click(); await page.waitForTimeout(400);
await shot('07-after-accept.png');

// unuse: back to exactly one editor
await page.locator('#sink').focus().catch(() => {});
await press(':'); await page.keyboard.type('(ed/unuse "guidelines")'); await press('Enter'); await page.waitForTimeout(800);
check('unuse: one pane, no explorer', (await page.locator('.pane').count()) === 1 && (await page.locator('.gx').count()) === 0);
check('unuse: no explorer CSS left', (await page.locator('style[data-guidelines]').count()) === 0);
await shot('08-unused.png');

for (const [s, n] of results) console.log(s, n);
if (log.length) console.log('console errors:\n' + log.join('\n'));
await browser.close(); stop();
process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
