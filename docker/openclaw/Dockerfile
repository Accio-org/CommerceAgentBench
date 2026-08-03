ARG BASE_IMAGE=commercecraftbench/openclaw:base-v1.3
FROM ${BASE_IMAGE}

# Legacy migration recipe retained for historical development only. It is not
# the lineage or build path of the pinned RealReplicaBench v1.3.1 runtime.
# Clear any proxy inherited from a caller-supplied legacy base.
ENV http_proxy="" \
    https_proxy="" \
    HTTP_PROXY="" \
    HTTPS_PROXY=""

RUN mkdir -p /benchmark/private /task \
             /opt/openclaw_proxy

# Install Bun (single binary). Used by:
# 1. screenshot_sidecar.ts as the preferred runtime (Node fallback also works)
# 2. mock services baked into derived images (e.g. alibaba_publish), which use
#    `bun:sqlite` and run via `bun src/index.js`
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
    && bun --version

# OpenRouter shim sidecar — optional, started by cli.py when
# --openclaw-openrouter-shim is on (or auto-started when --openclaw-thinking
# is on with an openrouter/... model). Hot-loaded at run time too: cli.py
# docker-cps the host copy, so dev iteration does not need a rebuild.
COPY proxy/openrouter_shim.py /opt/openclaw_proxy/openrouter_shim.py

# OpenClaw bundles a Chrome extension ("Browser Relay") at
# /usr/local/lib/node_modules/openclaw/assets/chrome-extension/. To reach the
# upstream-image entrypoint Chrome on 9222, we point Chrome's --load-extension
# at this path via EXTRA_LOAD_EXTENSIONS env at docker-run time. But the
# extension's `connectOrToggleForActiveTab` (the function chrome.action's
# onClicked listener calls to fire chrome.debugger.attach) is module-scoped
# — Runtime.evaluate from outside the SW module cannot see it, and we have
# no way to programmatically dispatch chrome.action.onClicked. So patch the
# bundled background.js to expose the function on globalThis. The harness's
# attach_openclaw_ext.ts then invokes it via CDP once the gateway/relay is up.
RUN cp -r /usr/local/lib/node_modules/openclaw/assets/chrome-extension /opt/openclaw-ext-patched \
    && cat >> /opt/openclaw-ext-patched/background.js <<'EXT_PATCH'

// real_replica_bench harness patch: expose internal helpers for external
// CDP-driven attach. Caller: harnesses/openclaw/attach_openclaw_ext.ts.
//
// __openclawConnectTab(tabId) is the preferred entry point — it bypasses
// connectOrToggleForActiveTab's `chrome.tabs.query({active:true,
// currentWindow:true})` lookup, which silently returns no tab when Chrome
// has no focused window in a headless Xvfb container, causing the connect
// to no-op. The attach script gets the tab id from chrome.tabs.create and
// passes it back so we always operate on a known tab.
globalThis.__openclawConnect = () => connectOrToggleForActiveTab();
globalThis.__openclawConnectTab = async (tabId) => {
  if (!tabId) throw new Error('__openclawConnectTab: tabId required');
  const existing = tabs.get(tabId);
  if (existing?.state === 'connected') return 'already-connected';
  if (tabOperationLocks.has(tabId)) return 'op-locked';
  tabOperationLocks.add(tabId);
  try {
    cancelReconnect();
    tabs.set(tabId, { state: 'connecting' });
    setBadge(tabId, 'connecting');
    await ensureRelayConnection();
    await attachTab(tabId);
    return 'ok';
  } finally {
    tabOperationLocks.delete(tabId);
  }
};
globalThis.__openclawState = () => ({
  relayWsState: typeof relayWs !== 'undefined' && relayWs ? relayWs.readyState : null,
  tabsCount: typeof tabs !== 'undefined' ? tabs.size : -1,
  attachedTabIds: typeof tabs !== 'undefined'
    ? Array.from(tabs.entries()).map(([id, v]) => ({ id, state: v?.state }))
    : null,
});
EXT_PATCH
