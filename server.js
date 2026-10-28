'use strict';
const { createApp, db } = require('./src/app');

const app = createApp();

async function start() {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  await db.init();
  app.listen(PORT, HOST, async () => {
    console.log('');
    console.log('«Πες το» ξεκίνησε!');
    console.log('  Τοπική διεύθυνση: http://localhost:' + PORT);
    try {
      const owner = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'").get();
      if (Number(owner.c) === 0) {
        console.log('');
        console.log('  Δεν υπάρχει ακόμα λογαριασμός ιδιοκτήτη.');
        console.log('  Δημιουργήστε έναν με: npm run setup-owner -- <όνομα χρήστη>');
      }
    } catch (error) {
      console.error('Database check failed:', error);
    }
    console.log('');
  });
}

module.exports = app;

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
