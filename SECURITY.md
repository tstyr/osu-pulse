# Dependency and secret handling

Never commit `.env.local`, `renderer/.env`, OAuth JSON, PostgreSQL backups,
runtime logs, uploaded audio or rendered videos. Before publishing, run:

```bash
node scripts/check-publish-secrets.mjs --staged
```

The check detects local configured credentials and common service token formats;
it is a safeguard, not a replacement for reviewing staged files. If a credential
was shared publicly, revoke and replace it at the provider.

## Dependency review (2026-10-03)

Next.js was updated to 16.3.8, Workflow to the 4.8.12 release line,
devalue to 5.9.4, and Workflow's Undici dependencies to 7.30.0. Other compatible
patch updates are recorded in `package-lock.json`. This removes the reported
critical Next.js and Piscina findings and the affected serialization/network
library versions. See the [Next.js advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j).

`npm audit` still reports findings in the build-tool downloader chain
(`http-cache-semantics` via `@swc/cli`), ESLint's glob chain (`braces`), and
Drizzle Kit's older development-only esbuild loader. The registry currently
offers no compatible patched versions for the first two chains. They are not
resolved by this update. Do not apply `npm audit fix --force`: it proposes
incompatible downgrades of framework tooling. Do not expose tool development
servers or pass untrusted glob patterns to them. Re-check upstream releases
before future deployments.

Run `npm audit --omit=dev` for the production dependency inventory and
`npm audit` for the full development/build inventory. An audit count includes
affected ancestor packages as well as the underlying vulnerable library.
