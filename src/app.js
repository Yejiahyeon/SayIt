'use strict';
const path = require('node:path');
const express = require('express');
const { ROOT, IS_CLOUD } = require('./paths');
const { db } = require('./db');
const { attachUser, requireAuth, requireSameOrigin, cleanupSessions } = require('./auth');
const { cookieParser } = require('./utils');
const storage = require('./storage');
const views = require('./views');
const authRoutes = require('./routes-auth');
const publicRoutes = require('./routes-public');
const councilRoutes = require('./routes-council');

function trustProxySetting() {
  const value = process.env.TRUST_PROXY || (process.env.VERCEL ? '1' : '');
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const trustProxy = trustProxySetting();
  if (trustProxy !== null) app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const isStatic = /^\/(?:style\.css|app\.js|manifest\.webmanifest|icons\/|fonts\/)/.test(req.path);
    if (!req.path.startsWith('/uploads/') && !isStatic) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '300kb' }));
  app.use(cookieParser);
  app.use(attachUser);
  app.use(requireSameOrigin);

  app.get('/uploads/:name', requireAuth, async (req, res, next) => {
    try {
      const image = await storage.readImage(req.params.name);
      if (!image) return res.status(404).send(views.notFoundPage({ user: req.user }));
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.send(image.buffer);
    } catch (error) {
      next(error);
    }
  });

  if (!IS_CLOUD) {
    app.use(express.static(path.join(ROOT, 'public'), {
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
      }
    }));
  }

  app.use(authRoutes);
  app.use(publicRoutes);
  app.use('/symvoulio', councilRoutes);

  app.use((req, res) => {
    res.status(404).send(views.notFoundPage({ user: req.user }));
  });

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    const tooLarge = err && err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 500).send(views.errorPage({
      title: tooLarge ? 'Η αίτηση είναι πολύ μεγάλη' : 'Κάτι πήγε στραβά',
      message: tooLarge
        ? 'Το μέγεθος της αίτησης υπερβαίνει το επιτρεπόμενο όριο.'
        : 'Παρουσιάστηκε ένα απρόσμενο σφάλμα. Δοκιμάστε ξανά σε λίγο.',
      user: req.user
    }));
  });

  cleanupSessions().catch(error => console.error('Session cleanup failed:', error));
  return app;
}

module.exports = { createApp, db };
