import http from 'node:http';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 3000);
const DAEMON_ORIGIN = String(
  process.env.OD_RENDERER_DAEMON_ORIGIN || 'http://open-design:7456'
).replace(/\/+$/, '');
const API_TOKEN = process.env.OD_API_TOKEN || '';

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MAX_WIDTH = 8192;
const MAX_HEIGHT = 30000;

let browserPromise;

function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    });
  }
  return browserPromise;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25 * 1024 * 1024) {
      throw new Error('request body too large');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function injectBaseHref(html, baseHref) {
  if (!baseHref) return html;

  const escaped = String(baseHref)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');

  const base = `<base href="${escaped}">`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  }

  return `${base}${html}`;
}

async function waitForPage(page) {
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async () => {
    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    } catch {}

    const images = Array.from(document.images || []);

    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();

        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 10000);
        });
      }),
    );
  });

  // Let layout, animation startup and lazy-loaded assets settle.
  await page.waitForTimeout(300);
}

async function installDaemonAuthentication(page) {
  if (!API_TOKEN) return;

  await page.route('**/*', async (route) => {
    const request = route.request();

    let target;
    try {
      target = new URL(request.url());
    } catch {
      return route.continue();
    }

    let daemon;
    try {
      daemon = new URL(DAEMON_ORIGIN);
    } catch {
      return route.continue();
    }

    // Never leak the OD token to third-party fonts/images/scripts.
    if (target.origin !== daemon.origin) {
      return route.continue();
    }

    return route.continue({
      headers: {
        ...request.headers(),
        authorization: `Bearer ${API_TOKEN}`,
      },
    });
  });
}

async function renderPage(input) {
  const width = Math.max(
    320,
    Math.min(MAX_WIDTH, Math.round(Number(input.width) || DEFAULT_WIDTH)),
  );
  const height = Math.max(
    200,
    Math.min(8192, Math.round(Number(input.height) || DEFAULT_HEIGHT)),
  );

  const b = await browser();

  const context = await b.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  try {
    await installDaemonAuthentication(page);

    const html = injectBaseHref(String(input.html || ''), input.baseHref);

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await waitForPage(page);

    if (input.viewportOnly === true) {

      const scroll = {

        x: Math.max(0, Number(input.scrollX) || 0),

        y: Math.max(0, Number(input.scrollY) || 0),

        canvasX: Math.max(0, Number(input.canvasScrollX) || 0),

        canvasY: Math.max(0, Number(input.canvasScrollY) || 0),

      };



      await page.evaluate((position) => {

        window.scrollTo(position.x, position.y);

        const canvas = document.querySelector('.design-canvas');

        if (canvas && typeof canvas.scrollTo === 'function') {

          canvas.scrollTo(position.canvasX, position.canvasY);

        }

      }, scroll);



      await page.waitForTimeout(50);



      const type=input.pageImageFormat==='jpeg'?'jpeg':'png';

      const buffer=await page.screenshot({

        type,

        fullPage:false,

        ...(type==='jpeg'?{quality:82}:{}),

        animations:'disabled',

        caret:'hide',

      });



      const mime=type==='jpeg'?'image/jpeg':'image/png';



      return {

        ok:true,

        mode:'page',

        width,

        height,

        slides:[`data:${mime};base64,${buffer.toString('base64')}`],

      };

    }


    const dimensions = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;

      return {
        width: Math.max(
          root?.scrollWidth || 0,
          body?.scrollWidth || 0,
          window.innerWidth || 0,
        ),
        height: Math.max(
          root?.scrollHeight || 0,
          body?.scrollHeight || 0,
          window.innerHeight || 0,
        ),
      };
    });

    if (dimensions.height > MAX_HEIGHT) {
      return {
        ok: false,
        errorCode: 'PAGE_TOO_TALL',
        error: `page height ${dimensions.height}px exceeds renderer limit ${MAX_HEIGHT}px`,
      };
    }

    const type = input.pageImageFormat === 'jpeg' ? 'jpeg' : 'png';

    const buffer = await page.screenshot({
      type,
      fullPage: true,
      ...(type === 'jpeg' ? { quality: 82 } : {}),
      animations: 'disabled',
      caret: 'hide',
    });

    const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';

    return {
      ok: true,
      mode: 'page',
      width: dimensions.width,
      height: dimensions.height,
      slides: [
        `data:${mime};base64,${buffer.toString('base64')}`,
      ],
    };
  } finally {
    await context.close();
  }
}

async function render(input) {
  if (!input || typeof input.html !== 'string') {
    return {
      ok: false,
      errorCode: 'RENDER_FAILED',
      error: 'html is required',
    };
  }

  /*
   * First milestone: self-hosted website/page rasterization.
   *
   * Deck support is deliberately kept separate until page image export is
   * proven against the real OpenDesign deployment.
   */
  if (input.deck === true) {
    return {
      ok: false,
      errorCode: 'RENDER_FAILED',
      error: 'deck rendering is not enabled in the initial self-hosted renderer',
    };
  }

  return await renderPage(input);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST' || req.url !== '/render-slides') {
    return json(res, 404, { error: 'not found' });
  }

  try {
    const input = await readJson(req);
    const result = await render(input);

    return json(res, result.ok ? 200 : 422, result);
  } catch (error) {
    console.error('[od-renderer] render failed', error);

    return json(res, 500, {
      ok: false,
      errorCode: 'RENDER_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[od-renderer] listening on 0.0.0.0:${PORT}`);
});

async function shutdown() {
  server.close();

  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {}
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
