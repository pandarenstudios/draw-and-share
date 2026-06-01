// Cloudflare Worker — Draw & Share submission proxy + admin proxy
// Keeps all GitHub API calls server-side so CORS never blocks the browser.
//
// Environment variables (Cloudflare dashboard → Settings → Variables):
//   GITHUB_TOKEN  — fine-grained PAT with Issues read/write on the repo
//   GITHUB_OWNER  — pandarenstudios
//   GITHUB_REPO   — draw-and-share
//
// KV namespace binding (wrangler.toml [[kv_namespaces]]):
//   BANNED_IPS    — stores banned IP addresses (required for IP blocking)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const ip  = request.headers.get('CF-Connecting-IP') ||
                request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
                'unknown';

    // Admin: list all banned IPs
    if (url.pathname === '/admin/bans' && request.method === 'GET') {
      return handleListBans(request, env);
    }
    // Admin: ban an IP + revoke all their open submissions
    if (url.pathname === '/admin/ban' && request.method === 'POST') {
      return handleBan(request, env);
    }
    // Admin: unban an IP  e.g. DELETE /admin/ban/1.2.3.4
    if (url.pathname.startsWith('/admin/ban/') && request.method === 'DELETE') {
      return handleUnban(request, env, url);
    }
    // Admin proxy: everything else under /admin/*
    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env, url);
    }

    // Submission endpoint: POST /
    if (request.method !== 'POST') {
      return cors(new Response('Method not allowed', { status: 405 }));
    }

    // Check IP ban
    if (env.BANNED_IPS) {
      const banned = await env.BANNED_IPS.get(ip);
      if (banned) {
        return cors(new Response('Submissions from your network are not allowed.', { status: 403 }));
      }
    }

    // Size guard
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > 5_000_000) {
      return cors(new Response('Payload too large', { status: 413 }));
    }

    let outer;
    try {
      outer = await request.json();
    } catch {
      return cors(new Response('Invalid JSON', { status: 400 }));
    }

    // The frontend sends { title, body: "<json string>", labels }.
    // Parse the inner body to validate and inject the IP.
    let sub;
    try {
      sub = typeof outer.body === 'string' ? JSON.parse(outer.body) : outer;
    } catch {
      return cors(new Response('Invalid submission data', { status: 400 }));
    }

    if (typeof sub.title   !== 'string' || !sub.title.trim())
      return cors(new Response('Missing title',    { status: 400 }));
    if (typeof sub.creator !== 'string' || !sub.creator.trim())
      return cors(new Response('Missing creator',  { status: 400 }));
    if (typeof sub.image   !== 'string' || !sub.image.startsWith('data:image/'))
      return cors(new Response('Invalid image',    { status: 400 }));
    if (sub.title.length > 200 || sub.creator.length > 100)
      return cors(new Response('Field too long',   { status: 400 }));

    // Rebuild issue body with IP injected
    const issueBody = JSON.stringify({
      title:     sub.title,
      creator:   sub.creator,
      image:     sub.image,
      submitted: sub.submitted || new Date().toISOString(),
      ip,
    });

    const res = await ghFetch(
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`,
      'POST',
      {
        title:  outer.title  || `[Submission] ${sub.title} — by ${sub.creator}`,
        body:   issueBody,
        labels: outer.labels || ['submission', 'pending'],
      },
      env.GITHUB_TOKEN
    );

    const data = await res.text();
    return cors(new Response(data, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};

// ── Admin: list banned IPs ────────────────────────────────────────────────────

async function handleListBans(request, env) {
  if (!request.headers.get('X-Admin-Token'))
    return cors(new Response('Unauthorized', { status: 401 }));
  if (!env.BANNED_IPS)
    return cors(new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }));

  const list = await env.BANNED_IPS.list();
  const bans = await Promise.all(
    list.keys.map(async ({ name }) => {
      const value = await env.BANNED_IPS.get(name, { type: 'json' });
      return { ip: name, ...(value || {}) };
    })
  );

  return cors(new Response(JSON.stringify(bans), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Admin: ban an IP ──────────────────────────────────────────────────────────

async function handleBan(request, env) {
  const adminToken = request.headers.get('X-Admin-Token');
  if (!adminToken) return cors(new Response('Unauthorized', { status: 401 }));

  let ip;
  try { ({ ip } = await request.json()); }
  catch { return cors(new Response('Invalid JSON', { status: 400 })); }
  if (!ip || typeof ip !== 'string')
    return cors(new Response('Missing ip', { status: 400 }));

  // Persist ban in KV
  if (env.BANNED_IPS) {
    await env.BANNED_IPS.put(ip, JSON.stringify({ banned_at: new Date().toISOString() }));
  }

  // Revoke all open pending + approved submissions from this IP
  const [pendingIssues, approvedIssues] = await Promise.all([
    fetchIssuesByLabel('pending',  adminToken, env),
    fetchIssuesByLabel('approved', adminToken, env),
  ]);

  let revoked = 0;
  for (const issue of [...pendingIssues, ...approvedIssues]) {
    try {
      const data = JSON.parse(issue.body);
      if (data.ip !== ip) continue;

      await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issue.number}/labels`,
        'POST', { labels: ['revoked'] }, adminToken);

      for (const label of issue.labels.map(l => l.name).filter(l => l === 'pending' || l === 'approved')) {
        await ghFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issue.number}/labels/${encodeURIComponent(label)}`,
          'DELETE', null, adminToken);
      }
      revoked++;
    } catch { /* skip malformed */ }
  }

  return cors(new Response(JSON.stringify({ revoked }), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Admin: unban an IP ────────────────────────────────────────────────────────

async function handleUnban(request, env, url) {
  if (!request.headers.get('X-Admin-Token'))
    return cors(new Response('Unauthorized', { status: 401 }));

  const ip = decodeURIComponent(url.pathname.replace('/admin/ban/', ''));
  if (!ip) return cors(new Response('Missing ip', { status: 400 }));

  if (env.BANNED_IPS) await env.BANNED_IPS.delete(ip);

  return cors(new Response(JSON.stringify({ unbanned: true }), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Admin proxy ───────────────────────────────────────────────────────────────

async function handleAdmin(request, env, url) {
  const adminToken = request.headers.get('X-Admin-Token');
  if (!adminToken) return cors(new Response('Unauthorized', { status: 401 }));

  const ghPath = url.pathname.replace(/^\/admin/, '') || '/';
  const ghUrl  = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${ghPath}${url.search}`;

  const reqBody = (request.method !== 'GET' && request.method !== 'DELETE')
    ? await request.text()
    : undefined;

  const res = await fetch(ghUrl, {
    method:  request.method,
    headers: {
      Authorization:  `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      Accept:         'application/vnd.github.v3+json',
      'User-Agent':   'draw-and-share-worker/1.0',
    },
    body: reqBody,
  });

  const data = await res.text();
  return cors(new Response(data, {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchIssuesByLabel(label, token, env) {
  const res = await ghFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?state=open&labels=${label}&per_page=100`,
    'GET', null, token
  );
  return res.ok ? res.json() : [];
}

function ghFetch(path, method, body, token) {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/vnd.github.v3+json',
      'User-Agent':   'draw-and-share-worker/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin',  '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  return r;
}
