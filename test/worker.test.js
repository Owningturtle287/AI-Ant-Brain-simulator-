import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anatomy, sculpt } from '../src/sculpt.js';

test('authored shell profiles produce finite geometry with mixed station curvature', () => {
  for (const [part, definition] of Object.entries(anatomy)) {
    const geometry = sculpt(definition);
    for (const attribute of ['position', 'normal']) {
      assert.ok(geometry.getAttribute(attribute).array.every(Number.isFinite), `${part} ${attribute}`);
    }
  }
});
