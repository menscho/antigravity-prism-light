import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ThoughtTranslatorService } from '../vendor/thought-translator/translator-service.mjs';

function createService(t, model, respond) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-chat-params-'));
  const service = new ThoughtTranslatorService({
    configDir,
    fetchImpl: async (_url, init) => respond(JSON.parse(init.body)),
  });
  t.after(() => {
    service.dispose();
    fs.rmSync(configDir, { recursive: true, force: true });
  });
  service.saveConfig({
    activeProfileId: 'local',
    proxyMode: 'direct',
    profiles: [{ id: 'local', baseUrl: 'http://localhost:1234/v1', model }],
  });
  return service;
}

function completion(content, finishReason = 'stop') {
  return Response.json({ choices: [{ message: { content }, finish_reason: finishReason }] });
}

test('GPT-5 connection, stream and batch use compatible chat completion parameters', async (t) => {
  const requests = [];
  let reply = '连通正常';
  const service = createService(t, 'gpt-5-mini', (body) => {
    requests.push(body);
    if ('max_tokens' in body || 'temperature' in body) {
      return new Response('Unsupported parameter', { status: 400 });
    }
    return completion(reply);
  });

  const connection = await service.testConnection();
  assert.equal(connection.ok, true, connection.error);
  assert.equal(connection.reply, reply);
  reply = '正在核对设置。';
  const stream = await service.translateAiStream('Checking the current settings.');
  assert.equal(stream.engine, 'ai');
  assert.equal(stream.text, reply);
  reply = '[0] 正在检查设置';
  const batch = await service.translateToolSummariesBatch({ items: ['Checking the settings'], bypassCache: true });
  assert.deepEqual(batch.items, ['正在检查设置']);

  assert.deepEqual(requests.map((r) => r.stream), [false, true, false]);
  assert.equal(requests[0].max_completion_tokens, 160);
  assert.equal('max_completion_tokens' in requests[1], false);
  assert.equal('max_completion_tokens' in requests[2], false);
});

test('provider-prefixed o-series retries without reasoning_effort and legacy models retain their sampling parameters', async (t) => {
  const requests = [];
  const service = createService(t, 'openai/o3-mini', (body) => {
    requests.push(body);
    if ('reasoning_effort' in body) return new Response('Unsupported reasoning_effort', { status: 422 });
    return completion('连通正常');
  });

  assert.equal((await service.testConnection()).ok, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, 'low');
  assert.equal('reasoning_effort' in requests[1], false);
  for (const body of requests) {
    assert.equal(body.max_completion_tokens, 160);
    assert.equal('max_tokens' in body, false);
    assert.equal('temperature' in body, false);
  }

  assert.equal((await service.testConnection({ model: 'gpt-4o-mini' })).ok, true);
  const legacy = requests.at(-1);
  assert.equal(legacy.max_tokens, 160);
  assert.equal(legacy.temperature, 0.2);
  assert.equal('max_completion_tokens' in legacy, false);
});

test('connection probe reports an empty completion when reasoning consumes the output budget', async (t) => {
  const service = createService(t, 'gpt-5-mini', () => completion('', 'length'));
  const result = await service.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.match(result.error, /输出上限/);
});
