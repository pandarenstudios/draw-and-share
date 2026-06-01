// Cloudflare Worker — Draw & Share submission proxy + admin proxy
// Keeps all GitHub API calls server-side so CORS never blocks the browser.
//
// Environment variables to set in the Cloudflare dashboard:
//   GITHUB_TOKEN  — fine-grained PAT with Issues read/write on the repo
//   GITHUB_OWNER  — pandarenstudios
//   GITHUB_REPO   — draw-and-share

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    // Admin proxy: /admin/* — caller supplies their own PAT via X-Admin-Token
    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env, url);
    }

    // Submission endpoint: POST /
    if (request.method !== 'POST') {
      return cors(new Response('Method not allowed', { status: 405 }));
    }

    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > 5_000_000) {
      return cors(new Response('Payload too large', { status: 413 }));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(new Response('Invalid JSON', { status: 400 }));
    }

    // Validate required fields
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return cors(new Response('Missing title', { status: 400 }));
    }
    if (typeof body.creator !== 'string' || !body.creator.trim()) {
      return cors(new Response('Missing creator', { status: 400 }));
    }
    if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) {
      return cors(new Response('Invalid image', { status: 400 }));
    }
    if (body.title.length > 200 || body.creator.length > 100) {
      return cors(new Response('Field too long', { status: 400 }));
    }

    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept:         'application/vnd.github.v3+json',
          'User-Agent':   'draw-and-share-worker/1.0',
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.text();
    return cors(new Response(data, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};

async function handleAdmin(request, env, url) {
  const adminToken = request.headers.get('X-Admin-Token');
  if (!adminToken) {
    return cors(new Response('Unauthorized', { status: 401 }));
  }

  // Strip /admin prefix → GitHub repos path
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

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin',  '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  return r;
}
