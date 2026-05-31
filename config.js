// ─── SETUP INSTRUCTIONS ────────────────────────────────────────────────────
//
//  1. Create a GitHub repository for submissions (e.g. "art-submissions")
//     It can be public or private. GitHub Pages for the main site can live
//     in a SEPARATE repo (e.g. your username.github.io repo).
//
//  2. In your submissions repo, create three labels:
//        submission   (color: #0075ca)
//        pending      (color: #e4e669)
//        approved     (color: #2ea44f)
//
//  3. Create a Personal Access Token:
//     https://github.com/settings/tokens/new
//     ➜ Fine-grained token  →  only select this submissions repo
//     ➜ Permissions: Issues → Read & write
//     ➜ Copy the token into `token` below.
//
//  4. To approve a submission:
//     ➜ Go to your submissions repo Issues tab
//     ➜ Open an issue with the "pending" label
//     ➜ Add the "approved" label  (and remove "pending" if you like)
//     ➜ The gallery updates automatically.
//
//  ⚠  This token will be visible in the page source. The only risk is
//     someone creating extra issues in your submissions repo. Revoke and
//     regenerate at any time if abused.
// ────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  github: {
    token: '',                    // Your GitHub Personal Access Token (see README or config comments)
    owner: 'pandarenstudios',    // Your GitHub username
    repo:  'draw-and-share',     // The submissions repository name
  }
};
