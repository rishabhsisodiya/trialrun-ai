import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { listEvents } from './feed.js';
import { seededStore } from './store.js';

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function createApp(store) {
  return createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/events') {
      const limit = url.searchParams.get('limit');
      return send(response, 200, listEvents(store, { limit: limit ? Number(limit) : undefined }));
    }
    return send(response, 404, { error: 'Not found' });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp(seededStore()).listen(port, () => console.log(`Activity feed on http://localhost:${port}/events`));
}
