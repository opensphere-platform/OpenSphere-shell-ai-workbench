// OpenSphere AI — CONSTITUTION-0003 Production subShell reference adapter.
const TAG = 'osp-ai-shell';
const RELEASE = '1.1.2';
// Host-owned module identity. The Main Shell mounts the subShell at /p/<pluginId>
// and proxies /api/plugins/<pluginId>, so nothing below may hardcode a route.
const PLUGIN_ID = 'ai-workbench';
let injected = false;
let activeContext = null;

function injectOnce(base) {
  if (injected) return;
  injected = true;
  window.__OSP_NG_API_BASE__ = base;
  window.__OSP_AI_API_BASE__ = base;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `${base}/app/styles.css?v=${RELEASE}`;
  css.setAttribute('data-osp-plugin', PLUGIN_ID);
  document.head.appendChild(css);
  const script = document.createElement('script');
  script.type = 'module';
  script.src = `${base}/app/main.js?v=${RELEASE}`;
  script.setAttribute('data-osp-plugin', PLUGIN_ID);
  document.head.appendChild(script);
}

function navigationFor(routeBase) {
  return [
    { id: PLUGIN_ID, label: 'AI-Workbench', route: routeBase },
  ];
}

async function contributeManual(ctx, routeBase) {
  if (!ctx.extensions.manual || !ctx.api?.fetch) {
    throw new Error('Manual contribution contract is unavailable');
  }
  const response = await ctx.api.fetch('plugins/manual/ai.ko.md', { cache: 'no-store' });
  if (!response.ok) throw new Error(`AI Manual fetch failed (HTTP ${response.status})`);
  const content = await response.text();
  ctx.extensions.manual.contribute({
    sourceId: 'opensphere-ai-hub',
    title: 'AI-Workbench',
    locale: 'ko-KR',
    route: routeBase,
    sourcePath: 'ui-shell/manual/ai.ko.md',
    content,
    tags: ['ai', 'workbench', 'pipeline', 'training', 'model', 'inference', 'evaluation', 'monitoring'],
  });
}

function contributeManualInBackground(ctx, routeBase) {
  void contributeManual(ctx, routeBase).catch((error) => {
    console.warn('[AI-Workbench] Manual contribution is temporarily unavailable', error);
  });
}

export function activate(ctx) {
  activeContext = ctx;
  const base = (ctx.api?.baseUrl ?? '').replace(/\/$/, '');
  const routeBase = ctx.routing?.basePath ?? `/p/${ctx.pluginId ?? PLUGIN_ID}`;
  const contexts = window.__OPENSPHERE_HOST_CONTEXTS__ ||= Object.create(null);
  contexts[PLUGIN_ID] = { api: { baseUrl: base, fetch: ctx.api?.fetch }, routing: ctx.routing };
  injectOnce(base);
  ctx.extensions.registerPage?.({ id: ctx.pluginId, title: 'AI-Workbench', navBand: 'Operate', elementTag: TAG });
  ctx.extensions.nav?.contribute(navigationFor(routeBase));
  ctx.extensions.search?.contribute({
    async query(q) {
      const response = await ctx.api.fetch(`search?q=${encodeURIComponent(q)}`);
      if (!response.ok) return [];
      const body = await response.json();
      return Array.isArray(body.items) ? body.items : [];
    },
  });
  // Manual content is an optional contribution. A slow manual endpoint must not
  // hold the Main Shell activation boundary or delay unrelated subShells.
  contributeManualInBackground(ctx, routeBase);
}

export function deactivate() {
  activeContext?.extensions.nav?.clear();
  activeContext?.extensions.search?.clear();
  activeContext?.extensions.manual?.clear();
  activeContext?.notify?.clear();
  if (window.__OPENSPHERE_HOST_CONTEXTS__) delete window.__OPENSPHERE_HOST_CONTEXTS__[PLUGIN_ID];
  document.querySelectorAll(`[data-osp-plugin="${PLUGIN_ID}"]`).forEach((node) => node.remove());
  delete window.__OSP_NG_API_BASE__;
  delete window.__OSP_AI_API_BASE__;
  activeContext = null;
  injected = false;
}
