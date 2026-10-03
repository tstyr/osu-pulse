import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Inspect only source candidates; never print matched secret values.
const secretValues = new Map();
for (const file of ['.env.local', 'renderer/.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || !/(?:TOKEN|SECRET|PASSWORD|ACCESS_KEY|DATABASE_URL)/.test(match[1])) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12) secretValues.set(value, match[1]);
  }
}
const staged = process.argv.includes('--staged');
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
const files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of new Set(files)) {
  if (!existsSync(file) || /\.(png|jpe?g|ico|woff2?|mp[34]|flac|wav|zip|jar)$/i.test(file)) continue;
  const contents = staged ? execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
  for (const [value, name] of secretValues) {
    if (contents.includes(value)) findings.push(`${file}: contains local ${name}`);
  }
  if (/^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m.test(contents)) findings.push(`${file}: contains a private key`);
  if (/(?:sb_secret_[A-Za-z0-9_-]{20,}|cfat_[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(contents)) findings.push(`${file}: contains a service credential`);
}
if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else console.log(`Secret check passed (${new Set(files).size} source files).`);
