/**
 * One-time Dropbox OAuth2 setup — gets a long-lived refresh token.
 *
 * Run once: node server/scripts/dropbox-auth-setup.js
 *
 * Prerequisites:
 *  1. Go to https://www.dropbox.com/developers/apps
 *  2. Select your app (or create one with Files.metadata.read + Files.content.write scopes)
 *  3. Under "OAuth 2" → "Redirect URIs" add:  http://localhost:3099/callback
 *  4. Copy your App Key and App Secret into the prompts below
 *
 * Output: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
 * Copy those three lines into server/.env and into Netlify environment variables.
 */

const http = require('http');
const { exec } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

(async () => {
  console.log('\n=== Dropbox OAuth2 Setup ===\n');
  const appKey    = (await ask('Paste your Dropbox App Key:    ')).trim();
  const appSecret = (await ask('Paste your Dropbox App Secret: ')).trim();
  rl.close();

  const redirectUri = 'http://localhost:3099/callback';
  const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&token_access_type=offline&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log('\nOpening browser to authorise… (if it doesn\'t open, copy the URL below)');
  console.log('\n' + authUrl + '\n');
  exec(`start "" "${authUrl}"`);  // Windows

  // Spin up a tiny local server to catch the callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3099');
      const code = url.searchParams.get('code');
      res.end('<h2>Auth complete — you can close this tab.</h2>');
      server.close();
      code ? resolve(code) : reject(new Error('No code in callback'));
    });
    server.listen(3099, () => console.log('Waiting for Dropbox redirect on localhost:3099…'));
    setTimeout(() => { server.close(); reject(new Error('Timed out after 120s')); }, 120_000);
  });

  console.log('\nExchanging code for tokens…');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: appKey,
      client_secret: appSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    console.error('Token exchange failed:', t);
    process.exit(1);
  }

  const d = await r.json();
  if (!d.refresh_token) {
    console.error('No refresh_token returned. Make sure your app requests offline access.');
    console.error(JSON.stringify(d, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Success! Add these three lines to server/.env AND Netlify environment variables:\n');
  console.log(`DROPBOX_APP_KEY=${appKey}`);
  console.log(`DROPBOX_APP_SECRET=${appSecret}`);
  console.log(`DROPBOX_REFRESH_TOKEN=${d.refresh_token}`);
  console.log('\nYou can delete DROPBOX_ACCESS_TOKEN once the above three are in place.\n');
})().catch(err => { console.error(err.message); process.exit(1); });
