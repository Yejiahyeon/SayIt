'use strict';
const storage = require('../src/storage');
const { createApp } = require('../src/app');

storage.assertConfigured();
module.exports = createApp();
