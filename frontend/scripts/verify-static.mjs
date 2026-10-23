import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? resolve(process.argv[2]) : join(project, 'dist');
const readJson = async name => JSON.parse(await readFile(join(output, 'data', name), 'utf8'));
const required = ['house_price_index', 'annual_net_earnings', 'hicp_index', 'hicp_annual_change',
  'median_equivalised_income', 'household_consumption_expenditure', 'household_consumption_volume',
  'housing_cost_overburden', 'household_price_level', 'rent_price_index', 'mortgage_borrowing_rate'];
const privateContent = /(?:postgres(?:ql)?:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/\s"']|$)|-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|github_pat_[\w]+|ghp_[\w]{20,}|[A-Z]:[\\/]Users[\\/]|\/Users\/|\/home\/)/i;

function officialUrl(value) {
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.password, 'A source URL is not public HTTPS.');
  assert(['ec.europa.eu', 'data.ecb.europa.eu', 'data-api.ecb.europa.eu'].includes(url.hostname), 'Unexpected statistical source host.');
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'The public build must not contain symbolic links.');
    result.push(...entry.isDirectory() ? await filesBelow(path) : [path]);
  }
  return result;
}

const bundle = await readJson('observations.json');
const analytics = await readJson('analytics.json');
assert.equal(bundle.schema_version, 1);
assert.equal(analytics.schema_version, 1);
assert.equal(analytics.exported_at, bundle.exported_at, 'Statistical and analytical snapshots differ.');
assert(Number.isFinite(Date.parse(bundle.exported_at)), 'A real snapshot timestamp is required.');
assert(Date.parse(bundle.exported_at) <= Date.now(), 'The snapshot is dated in the future.');
assert.deepEqual(bundle.countries.map(item => item.code).sort(), ['EE', 'LT', 'LV']);
const definitions = new Map(bundle.indicators.map(item => [item.code, item]));
assert.equal(definitions.size, bundle.indicators.length, 'Duplicate indicator definitions.');
for (const code of required) assert(definitions.has(code), `Missing indicator: ${code}`);
const seen = new Set();
for (const row of bundle.observations) {
  const definition = definitions.get(row.indicator);
  assert(definition && ['EE', 'LV', 'LT'].includes(row.country), 'Unknown indicator or country.');
  const key = `${row.country}/${row.indicator}/${row.period}`;
  assert(!seen.has(key), `Duplicate observation: ${key}`);
  seen.add(key);
  assert(row.value === null || typeof row.value === 'number' && Number.isFinite(row.value), 'Invalid observation value.');
  assert(row.status === null || typeof row.status === 'string', 'Invalid source flag.');
  assert.deepEqual(row.dimensions, definition.dimensions, 'Mixed observation dimensions.');
  assert(Number.isFinite(Date.parse(row.retrieved_at)) && Date.parse(row.retrieved_at) <= Date.now(), 'Invalid or future observation retrieval date.');
  officialUrl(row.source_url);
}
for (const definition of definitions.values()) {
  assert(definition.publisher && definition.attribution && definition.unit && definition.frequency, 'Missing source metadata.');
  officialUrl(definition.source_url);
  for (const country of ['EE', 'LV', 'LT']) assert(bundle.observations.some(row => row.indicator === definition.code && row.country === country), `No ${country} observations for ${definition.code}.`);
}
const analyticalKeys = new Set(analytics.analyses.map(item => item.key));
assert.equal(analyticalKeys.size, analytics.analyses.length);
for (const key of ['housing_earnings', 'housing_inflation', 'real_earnings', ...required.map(code => `indicator_change:${code}`)]) {
  assert(analyticalKeys.has(key), `Missing analysis: ${key}`);
}
for (const analysis of analytics.analyses) {
  assert(analysis.scenarios?.length && analysis.scenarios.some(item => item.base_period === analysis.default_base), `Missing default scenario: ${analysis.key}`);
  for (const scenario of analysis.scenarios) {
    assert(['available', 'unavailable'].includes(scenario.status) && Array.isArray(scenario.series) && Array.isArray(scenario.rankings), 'Incomplete analytical scenario.');
    assert(scenario.sources?.length && scenario.sources.every(item => item.source_url && item.attribution), 'Missing analytical sources.');
  }
}
const csv = await readFile(join(output, 'data/observations.csv'), 'utf8');
assert.equal(csv.trimEnd().split(/\r?\n/).length - 1, bundle.observations.length, 'CSV and JSON row counts differ.');

const html = await readFile(join(output, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
assert(scripts.length > 0 && scripts.every(src => src.startsWith('./assets/')), 'Entry scripts must use relative static asset paths.');
for (const src of scripts) await stat(join(output, src));
const headers = await readFile(join(output, '_headers'), 'utf8');
assert(headers.includes("connect-src 'self'") && headers.includes('immutable'), 'Public security/cache headers are missing.');

const files = await filesBelow(output);
const sizes = [];
const publicFiles = ['index.html', '_headers', 'data/observations.json', 'data/observations.csv', 'data/analytics.json'];
for (const path of files) {
  const name = relative(output, path).replaceAll('\\', '/');
  assert(publicFiles.includes(name) || /^assets\/[\w.-]+\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/.test(name), `Unexpected public file: ${name}`);
  const contents = await readFile(path);
  assert(contents.length <= 25 * 1024 * 1024, `Asset exceeds Cloudflare Pages' 25 MiB limit: ${name}`);
  if (/\.(?:js|json|html|css|csv)$/.test(name)) assert(!privateContent.test(contents.toString('utf8')), `Private configuration or localhost reference in ${name}`);
  sizes.push({ name, bytes: contents.length, gzip: gzipSync(contents).length });
}
assert(files.length <= 1000, 'Build exceeds the manual dashboard upload file limit.');
console.log(JSON.stringify({
  status: 'Static release checks passed', snapshot: bundle.exported_at,
  observations: bundle.observations.length, indicators: definitions.size, analyses: analytics.analyses.length,
  files: files.length, bytes: sizes.reduce((sum, item) => sum + item.bytes, 0),
  entryJavaScriptBytes: sizes.filter(item => scripts.some(src => src.slice(2) === item.name)).reduce((sum, item) => sum + item.bytes, 0),
  javaScriptGzipBytes: sizes.filter(item => item.name.endsWith('.js')).reduce((sum, item) => sum + item.gzip, 0),
  data: sizes.filter(item => item.name.startsWith('data/')),
}, null, 2));
