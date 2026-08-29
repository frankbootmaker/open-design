import type {
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from '@open-design/sidecar-proto';

export type ExternalSlideRenderer =
  (input: DesktopRenderSlidesInput) => Promise<DesktopRenderSlidesResult>;

function rewriteBaseHref(
  baseHref: string | undefined,
  daemonUrl: string | undefined,
): string | undefined {
  if (!baseHref || !daemonUrl) return baseHref;

  try {
    const source = new URL(baseHref);
    const target = new URL(daemonUrl);

    source.protocol = target.protocol;
    source.host = target.host;

    return source.toString();
  } catch {
    return baseHref;
  }
}

export function createExternalSlideRendererFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExternalSlideRenderer | null {
  const configured = env.OD_RENDERER_URL?.trim();
  if (!configured) return null;

  const rendererUrl = new URL(
    'render-slides',
    configured.endsWith('/') ? configured : `${configured}/`,
  ).toString();

  const daemonUrl = env.OD_RENDERER_DAEMON_URL?.trim();

  console.info('[od-renderer] external renderer enabled', {
    rendererUrl,
    daemonUrl: daemonUrl || null,
  });

  return async (
    input: DesktopRenderSlidesInput,
  ): Promise<DesktopRenderSlidesResult> => {
    // outputDir belongs to the daemon container. The remote renderer deliberately
    // returns data URLs instead, which the existing export route already accepts.
    const {
      outputDir: _outputDir,
      baseHref: inputBaseHref,
      ...remoteInput
    } = input;

    const rewrittenBaseHref = rewriteBaseHref(inputBaseHref, daemonUrl);

    const payload: DesktopRenderSlidesInput = {
      ...remoteInput,
      ...(rewrittenBaseHref !== undefined
        ? { baseHref: rewrittenBaseHref }
        : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000);

    try {
      const response = await fetch(rendererUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `external renderer HTTP ${response.status}${body ? `: ${body}` : ''}`,
        );
      }

      return await response.json() as DesktopRenderSlidesResult;
    } finally {
      clearTimeout(timer);
    }
  };
}
