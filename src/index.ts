import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const handle = serveStdio(() => createServer(config));

console.error('AndStrel Trading MCP is running in read-only mode');

process.on('SIGINT', () => {
  void handle.close();
});
