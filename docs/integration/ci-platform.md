# Companion Scan Quest: CI platform integration

Status as of 2026-11-02. This page sets out what the app uses on the CI platform, and
the changes that the platform owners still have to make. The user-facing side is in the
[Set up section of the README](../../README.md#set-up-sign-in-and-memory-servers).

## What the app uses

| Service | Used for | Configured in |
|---|---|---|
| CI Portal (`https://hub.ci.computer`) | Sign-in (OpenID Connect), the signed-in user's identity, and the list of the user's memory servers | `CI_PORTAL_URL` in `webxr-ar-ai/wrangler.toml` |
| Companion Memory servers (CI-Server) | A health check and the language-model list, for each server on the account | The Portal's app listing. The app holds no server addresses of its own. |
| Cloudflare Worker (`meta.ci.computer`) | Serves the app and the `/api/*` routes | `webxr-ar-ai/wrangler.toml` |

The app is a public OAuth client. Its client id is `ci-meta` (`CI_OAUTH_CLIENT_ID`), and it
has no secret.

## Sign-in flow

1. The user presses **Sign in with Companion Intelligence**. The browser reads the Portal
   URL and the client id from `GET /api/health` on the app's own origin. It creates a PKCE
   verifier and a state value, keeps them in `sessionStorage` for this tab, and opens the
   Portal's authorize endpoint with `response_type=code`, `client_id=ci-meta`,
   `redirect_uri=https://meta.ci.computer/`, `scope=openid profile email`, and
   `code_challenge_method=S256`.
2. The Portal sends the user back to `https://meta.ci.computer/?code=…&state=…`.
3. The app checks the state, then posts the code and the verifier to `POST /api/oauth/token`.
   The Worker exchanges them at the Portal's token endpoint and returns the access token,
   the ID token and the lifetime. The refresh token is never returned.
4. The app keeps the session in `localStorage` until the access token expires. It asks
   `GET /api/session` for the user's email and name; the Worker gets these from the
   Portal's userinfo endpoint.

## Memory discovery

Once a session exists, the app calls `POST /api/discover` with the tokens, without a tap:

1. The Worker calls `GET /api/users/me/apps?slug=ci-memory` on the Portal with the access
   token. The Portal answers this only for a registered public client.
2. For each listed server (at most three, and only with an `https` address, or a loopback
   address in development), the Worker calls `GET {server}/api/health` with a five-second
   timeout. If that passes, it calls `GET {server}/api/llm/models` with the ID token.
3. The overlay shows each server with its models. The user taps **Use** on one to choose it.
   The choice is kept in the browser, and signing out forgets it.

## Owner actions (not done yet)

These changes are in other repositories. Until they land, sign-in and discovery cannot
complete. Scene capture still works.

### CI-Portal

1. Register `ci-meta` as a public client in `PUBLIC_CLIENTS`:
   `{ clientId: 'ci-meta', name: 'Companion Scan Quest' }`.
2. Allow its redirect in `FIXED_PUBLIC_REDIRECTS`:
   `'ci-meta': ['https://meta.ci.computer/']`. The entry for `ci-er-connect` is the existing
   example of this pattern.
3. Optional, for local development: add the origin the Vite dev server uses (for example
   `https://127.0.0.1:8081/`) to the same entry. The Worker accepts a loopback redirect only
   on the root path. The Portal enforces its own list.

### CI-Server

4. Add `ci-meta` to `auth.portal.audience` on each memory server. Without it, the memory
   server treats the app as an unknown client, which gets capture rights only.

After the changes land, sign in on `https://meta.ci.computer/`, press **Find my servers
again**, and check that the server and its models appear.

## Local development

- `npm run dev` serves the app over https on port 8081.
- `npm run dev:worker` serves the Worker on port 8787. Vite forwards `/api/*` there;
  `WORKER_URL` changes the target.
- Sign-in in development also needs step 3 above, because the redirect is the dev origin.

## Security notes

- The client has no secret. It uses PKCE with the S256 method.
- The state is checked on return. The verifier is removed from `sessionStorage` after one use.
- The Worker accepts a redirect only to this site's root, or to a loopback root for
  development. The token route therefore cannot be used for another application.
- Refresh tokens stay in the Worker. The browser keeps the access and ID tokens until they expire.
- The Worker calls only `https` memory servers (or loopback `http` in development), with no
  credentials, query or fragment in the address, and at most three per request.
- `public/_headers` sets a Content Security Policy that limits where scripts and connections can load from.
