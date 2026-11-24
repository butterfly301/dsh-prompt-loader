import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLocalized } from '../index.js';

test('pickLocalized matches exact id, primary subtag, and falls back to English before other languages', () => {
  const map = {
    'de-pirate': 'Hallo',
    'en-pirate': 'Ahoy',
    'zh-pirate': '你好',
  };
  assert.equal(pickLocalized(map, 'zh-pirate'), '你好');
  assert.equal(pickLocalized(map, 'zh-CN'), '你好');
  assert.equal(pickLocalized(map, 'ja'), 'Ahoy');
  assert.equal(pickLocalized(map, undefined), 'Ahoy');
});
