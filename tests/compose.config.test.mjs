import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Do not resolve env_file: a config regression must never print real credentials on failure.
const result = spawnSync('docker', ['compose', 'config', '--no-env-resolution', '--format', 'json'], { encoding: 'utf8' });
assert.equal(result.status, 0, 'Docker Compose must accept the local configuration.');
const config = JSON.parse(result.stdout);
const services = config.services;

// All five apps use the monorepo root, while Mongo is an independent official image.
test('Compose defines six services and a build for each app', () => {
  assert.deepEqual(Object.keys(services).sort(), ['mongodb', 'auth-service', 'project-service',
    'ai-orchestrator-service', 'execution-service', 'frontend'].sort());
  assert.equal(services.mongodb.image, 'mongo:8.0');
  for (const [name, service] of Object.entries(services)) {
    if (name !== 'mongodb') assert.equal(typeof service.build?.dockerfile, 'string');
  }
});

// Only the local browser entry point is published; no DB, privileged mode or host mounts.
test('backend ports and credentials stay out of the browser container', () => {
  for (const [name, service] of Object.entries(services)) {
    assert.notEqual(service.privileged, true, `${name} must not be privileged.`);
    assert.equal((service.volumes ?? []).some(volume => volume.type === 'bind'), false);
    if (name !== 'frontend') assert.equal((service.ports ?? []).length, 0);
  }
  assert.equal(services.frontend.ports.length, 1);
  assert.equal(services.frontend.ports[0].host_ip, '127.0.0.1');
  assert.deepEqual(Object.keys(services.frontend.environment).sort(),
    ['NODE_ENV', 'NEXT_TELEMETRY_DISABLED', 'AUTH_SERVICE_URL', 'PROJECT_SERVICE_URL'].sort());
});

// Ready dependencies and persistent storage are separate requirements, not startup guesses.
test('health checks, service-name URLs and a named Mongo volume are configured', () => {
  for (const service of Object.values(services)) assert.ok(service.healthcheck?.test?.length);
  assert.equal(services['auth-service'].depends_on.mongodb.condition, 'service_healthy');
  assert.equal(services['project-service'].depends_on['ai-orchestrator-service'].condition, 'service_healthy');
  assert.equal(services.frontend.depends_on['project-service'].condition, 'service_healthy');
  assert.equal(services.frontend.environment.AUTH_SERVICE_URL, 'http://auth-service:4000');
  assert.equal(services['project-service'].environment.AI_ORCHESTRATOR_URL, 'http://ai-orchestrator-service:6001');
  assert.equal(services['ai-orchestrator-service'].environment.PORT, '6001');
  assert.equal(services.mongodb.volumes[0].type, 'volume');
  assert.equal(services.mongodb.volumes[0].target, '/data/db');
});

// Each image installs its own workspace and never copies host dependency folders or .env files.
test('application Dockerfiles use scoped locked installs and non-root users', () => {
  for (const [name, service] of Object.entries(services)) {
    if (name === 'mongodb') continue;
    const file = readFileSync(service.build.dockerfile, 'utf8');
    const workspace = name === 'frontend' ? 'nextjs-boilerplate' : name;
    assert.ok(file.includes(`npm ci --workspace ${workspace}`));
    assert.match(file, /USER node/);
    assert.doesNotMatch(file, /^COPY\s+.*\.env/m);
  }
  const ignore = readFileSync('.dockerignore', 'utf8');
  for (const rule of ['**/.env', '**/.env.*', '**/node_modules', '.git']) assert.ok(ignore.split(/\r?\n/).includes(rule));
  assert.ok(readFileSync(services.frontend.build.dockerfile, 'utf8')
    .includes('RUN chown -R node:node /app/nextjs-boilerplate'));
});
