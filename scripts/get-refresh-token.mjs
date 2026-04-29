#!/usr/bin/env node
//
// One-time script to obtain a Chrome Web Store API refresh token.
//
// Prerequisites:
//   1. Create OAuth client credentials (Desktop type) in Google Cloud Console
//   2. Run: node scripts/get-refresh-token.mjs <client_id> <client_secret>
//   3. Open the URL printed, authorize, paste the code back here
//   4. Save the refresh_token as a GitHub secret (CHROME_REFRESH_TOKEN)

import http from "node:http";
import { execSync } from "node:child_process";

const SCOPES = "https://www.googleapis.com/auth/chromewebstore";
const REDIRECT_PORT = 8976;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/get-refresh-token.mjs <client_id> <client_secret>");
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/auth` +
  `?client_id=${clientId}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for redirect...\n");

try {
  execSync(`start "${authUrl}"`, { stdio: "ignore" });
} catch {
  // ignore if open fails — user can copy-paste
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing code parameter");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("Token exchange failed:", tokenData);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Token exchange failed: " + tokenData.error_description);
    } else {
      console.log("\n=== Save these as GitHub repository secrets ===\n");
      console.log(`CHROME_CLIENT_ID=${clientId}`);
      console.log(`CHROME_CLIENT_SECRET=${clientSecret}`);
      console.log(`CHROME_REFRESH_TOKEN=${tokenData.refresh_token}`);
      console.log("");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Done! Check your terminal for the credentials. You can close this tab.</h2>");
    }
  } catch (err) {
    console.error("Error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Error: " + err.message);
  }

  server.close();
});

server.listen(REDIRECT_PORT, () => {
  console.log(`Listening on port ${REDIRECT_PORT}...`);
});
