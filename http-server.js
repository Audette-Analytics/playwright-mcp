#!/usr/bin/env node
/**
 * HTTP wrapper for Playwright MCP
 * Exposes the stdio-based MCP server over HTTP for Railway deployment
 */

const express = require('express');
const { spawn } = require('child_process');
const { Readable, Writable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

app.use(express.json());

// Authentication middleware
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  if (AUTH_TOKEN && token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'playwright-mcp' });
});

// MCP endpoint
app.post('/mcp', async (req, res) => {
  try {
    // Spawn the Playwright MCP CLI process
    const mcp = spawn('node', ['/app/cli.js', '--headless', '--browser', 'chromium', '--no-sandbox'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let responseData = '';
    let errorData = '';

    mcp.stdout.on('data', (data) => {
      responseData += data.toString();
    });

    mcp.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    mcp.on('close', (code) => {
      if (code !== 0) {
        console.error('MCP process error:', errorData);
        return res.status(500).json({ error: 'MCP process failed', details: errorData });
      }

      try {
        const result = JSON.parse(responseData);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: 'Invalid JSON response', details: responseData });
      }
    });

    // Send the request to MCP stdin
    mcp.stdin.write(JSON.stringify(req.body) + '\n');
    mcp.stdin.end();

  } catch (error) {
    console.error('Error handling MCP request:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Playwright MCP HTTP server listening on port ${PORT}`);
});
