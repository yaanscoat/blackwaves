/*
 * blackwaves network filter engine: compiles and matches Chrome declarativeNetRequest rules.
 * Shared by the page (compile) and the service worker (match). Every proxied request from all
 * three engines passes through the service worker, so this is where ads actually get blocked
 * for BlackWaves Shield and for DNR extensions like uBlock Origin Lite.
 *
 * Supported: block / allow / allowAllRequests / redirect (extensionPath, url) actions;
 * urlFilter, regexFilter, requestDomains, excludedRequestDomains, initiatorDomains,
 * excludedInitiatorDomains, resourceTypes, excludedResourceTypes, requestMethods,
 * excludedRequestMethods, domainType. Skipped: modifyHeaders, upgradeScheme, responseHeaders,
 * tabIds conditions.
 */
(function (root) {
  const TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
  const BIT = Object.fromEntries(TYPES.map((t, i) => [t, 1 << i]));
  const ALL = (1 << TYPES.length) - 1;
  // Same priority: allow beats allowAllRequests beats block beats redirect (Chrome's order)
  const RANK = { allow: 4, allowAllRequests: 3, block: 2, redirect: 1 };
  const TWO_PART = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil', 'nic', 'ltd', 'plc', 'sch']);

  function urlFilterToRegExp(filter, caseSensitive) {
    let s = filter;
    let prefix = '';
    let suffix = '';
    if (s.startsWith('||')) {
      prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?';
      s = s.slice(2);
    } else if (s.startsWith('|')) {
      prefix = '^';
      s = s.slice(1);
    }
    if (s.endsWith('|')) {
      suffix = '$';
      s = s.slice(0, -1);
    }
    let body = '';
    for (const ch of s) {
      if (ch === '*') body += '.*';
      else if (ch === '^') body += '(?:[^a-zA-Z0-9_.%-]|$)';
      else body += ch.replace(/[.+?${}()|[\]\\/]/g, '\\$&');
    }
    return new RegExp(prefix + body + suffix, caseSensitive ? '' : 'i');
  }

  // Longest token in the pattern that is guaranteed to appear as a whole token in a matching URL.
  function pickToken(filter) {
    let s = filter.toLowerCase();
    let startBounded = false;
    if (s.startsWith('||') || s.startsWith('|')) {
      s = s.replace(/^\|\|?/, '');
      startBounded = true;
    }
    let endBounded = false;
    if (s.endsWith('|')) {
      s = s.slice(0, -1);
      endBounded = true;
    }
    let best = null;
    const re = /[a-z0-9%]{2,}/g;
    let m;
    while ((m = re.exec(s))) {
      const before = m.index === 0 ? (startBounded ? '' : '*') : s[m.index - 1];
      const afterIndex = m.index + m[0].length;
      const after = afterIndex === s.length ? (endBounded ? '' : '*') : s[afterIndex];
      if (before === '*' || after === '*') continue;
      if (/^(https?|www|com|net|org)$/.test(m[0])) continue;
      if (!best || m[0].length > best.length) best = m[0];
    }
    return best;
  }

  const lowerSet = (list) => (Array.isArray(list) && list.length ? new Set(list.map((d) => String(d).toLowerCase())) : null);

  function hostInSet(host, set) {
    if (!host || !set) return false;
    let h = host;
    for (;;) {
      if (set.has(h)) return true;
      const dot = h.indexOf('.');
      if (dot < 0) return false;
      h = h.slice(dot + 1);
    }
  }

  function regDomain(host) {
    if (!host) return '';
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const n = parts.length;
    if (parts[n - 1].length === 2 && TWO_PART.has(parts[n - 2])) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  }

  /** sources: [{ id, rules: [DNR rule] }] -> structured-clone-friendly engine */
  function compile(sources) {
    const rules = [];
    const byHost = new Map();
    const byToken = new Map();
    const generic = [];
    const add = (map, key, idx) => {
      const list = map.get(key);
      if (list) list.push(idx);
      else map.set(key, [idx]);
    };
    let skipped = 0;
    sources.forEach((source, x) => {
      for (const rule of source.rules || []) {
        const action = rule && rule.action;
        const c = (rule && rule.condition) || {};
        if (!action || !(action.type in RANK) || c.responseHeaders || c.excludedResponseHeaders || c.tabIds || c.excludedTabIds) {
          skipped++;
          continue;
        }
        let mask = c.resourceTypes ? c.resourceTypes.reduce((m, t) => m | (BIT[t] || 0), 0) : ALL & ~BIT.main_frame;
        if (c.excludedResourceTypes) mask &= ~c.excludedResourceTypes.reduce((m, t) => m | (BIT[t] || 0), 0);
        if (!c.resourceTypes && c.excludedResourceTypes && !c.excludedResourceTypes.includes('main_frame')) mask |= BIT.main_frame;
        let re = null;
        try {
          if (c.regexFilter) re = new RegExp(c.regexFilter, c.isUrlFilterCaseSensitive ? '' : 'i');
          else if (c.urlFilter) re = urlFilterToRegExp(c.urlFilter, c.isUrlFilterCaseSensitive);
        } catch {
          skipped++;
          continue;
        }
        let red = null;
        if (action.type === 'redirect') {
          const r = action.redirect || {};
          if (r.extensionPath) red = { ext: source.id, path: r.extensionPath };
          else if (r.url) red = { url: r.url };
          else {
            skipped++;
            continue;
          }
        }
        const idx = rules.length;
        rules.push({
          x,
          p: rule.priority || 1,
          a: action.type,
          m: mask,
          rm: c.requestMethods ? c.requestMethods.map((s) => s.toUpperCase()) : null,
          xrm: c.excludedRequestMethods ? c.excludedRequestMethods.map((s) => s.toUpperCase()) : null,
          dt: c.domainType === 'firstParty' ? 1 : c.domainType === 'thirdParty' ? 2 : 0,
          i: lowerSet(c.initiatorDomains),
          xi: lowerSet(c.excludedInitiatorDomains),
          rd: lowerSet(c.requestDomains),
          xrd: lowerSet(c.excludedRequestDomains),
          re,
          red,
        });
        // index for fast lookup
        if (c.requestDomains && c.requestDomains.length) {
          for (const d of c.requestDomains) add(byHost, String(d).toLowerCase(), idx);
          continue;
        }
        const f = c.urlFilter;
        if (f && !c.regexFilter) {
          const hm = f.match(/^\|\|([a-z0-9.-]+)(?=[/^:?|]|$)/i);
          if (hm && !hm[1].endsWith('.') && hm[1].includes('.')) {
            add(byHost, hm[1].toLowerCase(), idx);
            continue;
          }
          const token = pickToken(f);
          if (token) {
            add(byToken, token, idx);
            continue;
          }
        }
        generic.push(idx);
      }
    });
    return { sources: sources.map((s) => s.id), rules, byHost, byToken, generic, skipped, built: Date.now() };
  }

  function test(r, req) {
    if (!(r.m & (BIT[req.type] || BIT.other))) return false;
    if (r.rm && !r.rm.includes(req.method)) return false;
    if (r.xrm && r.xrm.includes(req.method)) return false;
    if (r.dt) {
      const third = !!req.initiatorHost && regDomain(req.host) !== regDomain(req.initiatorHost);
      if ((r.dt === 2) !== third) return false;
    }
    if (r.i && !hostInSet(req.initiatorHost, r.i)) return false;
    if (r.xi && hostInSet(req.initiatorHost, r.xi)) return false;
    if (r.rd && !hostInSet(req.host, r.rd)) return false;
    if (r.xrd && hostInSet(req.host, r.xrd)) return false;
    if (r.re && !r.re.test(req.url)) return false;
    return true;
  }

  function better(r, cur) {
    if (!cur) return true;
    if (r.p !== cur.p) return r.p > cur.p;
    return RANK[r.a] > RANK[cur.a];
  }

  // Best matching rule per source for one request.
  function bestPerSource(engine, req, onlyAction) {
    const seen = new Set();
    const best = new Map();
    const consider = (list) => {
      if (!list) return;
      for (const idx of list) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        const r = engine.rules[idx];
        if (onlyAction && r.a !== onlyAction) continue;
        if (test(r, req) && better(r, best.get(r.x))) best.set(r.x, r);
      }
    };
    let h = req.host;
    while (h) {
      consider(engine.byHost.get(h));
      const dot = h.indexOf('.');
      h = dot < 0 ? '' : h.slice(dot + 1);
    }
    for (const t of req.url.toLowerCase().split(/[^a-z0-9%]+/)) if (t.length > 1) consider(engine.byToken.get(t));
    consider(engine.generic);
    return best;
  }

  /**
   * req: { url, type, method, initiatorUrl, frameUrl, frameType }
   * returns null (allow) or { action: 'block' | 'redirect', source, redirect }
   */
  function match(engine, req) {
    if (!engine || !engine.rules.length) return null;
    let host;
    try {
      host = new URL(req.url).hostname.toLowerCase();
    } catch {
      return null;
    }
    let initiatorHost = '';
    try {
      initiatorHost = req.initiatorUrl ? new URL(req.initiatorUrl).hostname.toLowerCase() : '';
    } catch {}
    const full = { url: req.url, host, type: req.type, method: (req.method || 'GET').toUpperCase(), initiatorHost };
    const best = bestPerSource(engine, full);
    if (!best.size) return null;

    // allowAllRequests on the document that made the request lifts blocking for that source
    let frameAllow = null;
    if (req.frameUrl && [...best.values()].some((r) => r.a === 'block' || r.a === 'redirect')) {
      try {
        const fh = new URL(req.frameUrl).hostname.toLowerCase();
        frameAllow = bestPerSource(engine, { url: req.frameUrl, host: fh, type: req.frameType || 'main_frame', method: 'GET', initiatorHost: '' }, 'allowAllRequests');
      } catch {}
    }
    let redirect = null;
    for (const [x, r] of best) {
      if (r.a !== 'block' && r.a !== 'redirect') continue;
      const fa = frameAllow && frameAllow.get(x);
      if (fa && fa.p >= r.p) continue;
      if (r.a === 'block') return { action: 'block', source: engine.sources[x] };
      if (!redirect) redirect = { action: 'redirect', source: engine.sources[x], redirect: r.red };
    }
    return redirect;
  }

  root.BWFilterEngine = { compile, match, regDomain, urlFilterToRegExp, TYPES };
})(typeof self !== 'undefined' ? self : globalThis);
