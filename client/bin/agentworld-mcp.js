#!/usr/bin/env node
'use strict';

const { MCPServer } = require('../src/mcp/server');

const server = new MCPServer();
server.start().catch(err => {
  process.stderr.write(`[AgentWorld MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
