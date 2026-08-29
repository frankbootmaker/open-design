import type {
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from '@open-design/sidecar-proto';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createExternalSlideRendererFromEnv } from '../src/external-slide-renderer.js';

function renderInput(
  overrides: Record<string, unknown> = {},
): DesktopRenderSlidesInput {
  return {
    html: '<html><body>test</body></html>',
    ...overrides,
  } as unknown as DesktopRenderSlidesInput;
}

describe('createExternalSlideRendererFromEnv', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null when OD_RENDERER_URL is not configured', () => {
    expect(createExternalSlideRendererFromEnv({})).toBeNull();

    expect(
      createExternalSlideRendererFromEnv({
        OD_RENDERER_URL: '   ',
      }),
    ).toBeNull();
  });

  it('posts render requests to the configured renderer endpoint', async () => {
    const expectedResult = {
      images: ['data:image/png;base64,test'],
    } as unknown as DesktopRenderSlidesResult;

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(expectedResult), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
    });

    expect(renderer).not.toBeNull();

    const result = await renderer!(renderInput());

    expect(result).toEqual(expectedResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://renderer:3000/render-slides',
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    });
  });

  it('removes outputDir from the remote renderer payload', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ images: [] }), {
        status: 200,
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
    });

    await renderer!(
      renderInput({
        outputDir: '/tmp/daemon-only-output',
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(payload).not.toHaveProperty('outputDir');
  });

  it('rewrites baseHref to the renderer-accessible daemon origin', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ images: [] }), {
        status: 200,
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
      OD_RENDERER_DAEMON_URL: 'http://host.docker.internal:7456',
    });

    await renderer!(
      renderInput({
        baseHref: 'http://127.0.0.1:7456/api/projects/example/files/index.html',
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(payload.baseHref).toBe(
      'http://host.docker.internal:7456/api/projects/example/files/index.html',
    );
  });

  it('forwards viewport capture and scroll coordinates unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ images: [] }), {
        status: 200,
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
    });

    await renderer!(
      renderInput({
        viewportOnly: true,
        width: 1440,
        height: 900,
        scrollX: 12,
        scrollY: 345,
        canvasScrollX: 67,
        canvasScrollY: 890,
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(payload).toMatchObject({
      viewportOnly: true,
      width: 1440,
      height: 900,
      scrollX: 12,
      scrollY: 345,
      canvasScrollX: 67,
      canvasScrollY: 890,
    });
  });

  it('reports non-success renderer responses with status and response body', async () => {
    fetchMock.mockResolvedValue(
      new Response('renderer exploded', {
        status: 500,
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
    });

    await expect(renderer!(renderInput())).rejects.toThrow(
      'external renderer HTTP 500: renderer exploded',
    );
  });

  it('rejects malformed renderer JSON responses', async () => {
    fetchMock.mockResolvedValue(
      new Response('this is not json', {
        status: 200,
      }),
    );

    const renderer = createExternalSlideRendererFromEnv({
      OD_RENDERER_URL: 'http://renderer:3000',
    });

    await expect(renderer!(renderInput())).rejects.toThrow();
  });
});
