#!/usr/bin/env node
/**
 * HTTP/SSE wrapper for Playwright MCP
 * Exposes the stdio-based MCP server over HTTP for Railway deployment
 */

const express = require('express');
const { spawn } = require('child_process');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

app.use(express.json());

// Authentication middleware
const authenticate = (req, res, next) => {
  if (!AUTH_TOKEN) {
    return next(); // No auth required if token not set
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
  }

  const token = authHeader.substring(7);
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid authorization token' });
  }

  next();
};

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'playwright-mcp',
    version: require('./package.json').version
  });
});

// MCP endpoint
app.post('/mcp', authenticate, async (req, res) => {
  try {
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Create SSE transport
    const transport = new SSEServerTransport('/mcp', res);

    // Spawn Playwright MCP process
    const mcp = spawn('node', [
      '/app/cli.js',
      '--headless',
      '--browser', 'chromium',
      '--no-sandbox'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Pipe transport to MCP process
    transport.on('message', (message) => {
      mcp.stdin.write(JSON.stringify(message) + '\n');
    });

    mcp.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          transport.send(message);
        } catch (e) {
          console.error('Failed to parse MCP output:', line);
        }
      }
    });

    mcp.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    mcp.on('close', (code) => {
      console.log('MCP process exited with code:', code);
      res.end();
    });

    // Handle client disconnect
    req.on('close', () => {
      mcp.kill();
    });

    // Start the transport
    await transport.start();

  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Playwright MCP HTTP server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
