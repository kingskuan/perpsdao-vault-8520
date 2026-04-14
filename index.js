import runApp from './lib/core.js';

const port = process.env.PORT || 3000;
const pacifica = require('./pacifica');
app.use('/api/pacifica', pacifica);

(async () => {
  try {
    await runApp({ port });
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  }
})();
