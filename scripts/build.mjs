import { cp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateConfig } from '../src/cloud.js';
const configURL = process.env.SUPABASE_URL;
const configKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!!configURL !== !!configKey) throw new Error('SUPABASE_URL and a public Supabase key must be configured together.');
const cloudConfig = configURL ? validateConfig({ url: configURL, publicKey: configKey }) : null;
for (const file of ['src/model.js', 'src/cloud.js', 'src/cloud-config.js', 'src/pwa.js', 'src/pwa-config.js', 'src/app.js', 'sw.js']) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'assets', 'src']) await cp(file, `dist/${file}`, { recursive: true });
if (cloudConfig) await writeFile('dist/src/cloud-config.js', `// Public browser configuration\nexport default ${JSON.stringify(cloudConfig)};\n`);
await writeFile('dist/src/pwa-config.js', 'export default { enabled: true };\n');
async function filesIn(directory = '') {
  const files = [];
  for (const entry of await readdir(`dist/${directory}`, { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(path)); else files.push(path);
  }
  return files.sort();
}
const files = await filesIn();
const hash = createHash('sha256');
hash.update(await readFile('sw.js'));
for (const file of files) { hash.update(file); hash.update(await readFile(`dist/${file}`)); }
const version = hash.digest('hex').slice(0, 20);
const worker = (await readFile('sw.js', 'utf8')).replace('__BUILD_ID__', version).replace('/* PRECACHE */ []', JSON.stringify(files.map(file => `./${file}`)));
await writeFile('dist/sw.js', worker);
await writeFile('dist/.nojekyll', '');
execFileSync(process.execPath, ['--check', 'dist/sw.js'], { stdio: 'inherit' });
console.log('Built static site in dist/ (no external runtime dependencies).');
