// Renderer entry point: build the services and start the app.

import { App } from './app/app.js';
import { UI } from './ui/ui.js';
import { Sound } from './audio/sound.js';
import { createFileService } from './fs/fileService.js';

async function boot() {
  const files = await createFileService();
  const app = new App({
    canvas: document.getElementById('stage'),
    ui: new UI(),
    files,
    sound: new Sound(),
  });
  app.start();
  // Handy for debugging from DevTools; holds no extra capabilities.
  window.__paperToss = app;
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = `Paper Toss failed to start: ${err && err.message ? err.message : err}`;
});
