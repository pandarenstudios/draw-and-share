// Cloudflare Worker — Draw & Share submission proxy
// Keeps the GitHub token server-side so it never appears in the browser.
//
// Environment variables to set in the Cloudflare dashboard:
//   GITHUB_TOKEN  — fine-grained PAT with Issues read/write on the repo
//   GITHUB_OWNER  — pandarenstudios
//   GITHUB_REPO   — draw-and-share

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    if (request.method !== 'POST') {
      return cors(new Response('Method not allowed', { status: 405 }));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(new Response('Invalid JSON', { status: 400 }));
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

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin',  '*');
  r.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return r;
}
