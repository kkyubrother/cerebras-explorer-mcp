import assert from 'node:assert/strict';
import { serviceMode } from '../src/service.mjs';

assert.equal(serviceMode(), 'safe');
