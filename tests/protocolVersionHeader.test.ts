import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, ChildProcess } from 'child_process'

// Regression test for https://github.com/supercorp-ai/supergateway/issues/117
//
// A spec-compliant client sends the negotiated protocol version back on
// every request *after* initialize via the `MCP-Protocol-Version` header
// (see MCP spec, Streamable HTTP transport). If supergateway's vendored
// @modelcontextprotocol/sdk doesn't recognize that version string yet,
// the very next request (typically `notifications/initialized`) is
// rejected with 400 "Unsupported protocol version" before it ever reaches
// the child MCP server — even though initialize itself succeeded.
//
// This is hardcoded to the literal version string that broke in
// production (not imported from the installed SDK's own
// LATEST_PROTOCOL_VERSION export) on purpose: deriving it from the SDK
// under test makes the assertion self-referential and unable to catch a
// stale vendored SDK, which is exactly the bug this guards against.
const NEGOTIATED_PROTOCOL_VERSION = '2025-11-25'

async function initializeAndGetProtocolVersion(mcpUrl: string) {
  const initRes = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: NEGOTIATED_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'regression-test', version: '1.0.0' },
      },
    }),
  })
  assert.strictEqual(initRes.status, 200)
  const sessionId = initRes.headers.get('mcp-session-id') ?? undefined
  return sessionId
}

function followUpHeaders(sessionId: string | undefined) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': NEGOTIATED_PROTOCOL_VERSION,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  return headers
}

let statelessProc: ChildProcess
let statefulProc: ChildProcess

const STATELESS_PORT = 11006
const STATELESS_URL = `http://localhost:${STATELESS_PORT}/mcp`
const STATEFUL_PORT = 11007
const STATEFUL_URL = `http://localhost:${STATEFUL_PORT}/mcp`

test.before(async () => {
  statelessProc = spawn(
    'npm',
    [
      'run',
      'start',
      '--',
      '--stdio',
      'node tests/helpers/mock-mcp-server.js stdio',
      '--outputTransport',
      'streamableHttp',
      '--port',
      String(STATELESS_PORT),
      '--streamableHttpPath',
      '/mcp',
    ],
    { stdio: 'ignore', shell: false },
  )
  statelessProc.unref()

  statefulProc = spawn(
    'npm',
    [
      'run',
      'start',
      '--',
      '--stdio',
      'node tests/helpers/mock-mcp-server.js stdio',
      '--outputTransport',
      'streamableHttp',
      '--stateful',
      '--port',
      String(STATEFUL_PORT),
      '--streamableHttpPath',
      '/mcp',
    ],
    { stdio: 'ignore', shell: false },
  )
  statefulProc.unref()

  await new Promise((r) => setTimeout(r, 2000))
})

test.after(async () => {
  statelessProc.kill('SIGINT')
  statefulProc.kill('SIGINT')
  await Promise.all([
    new Promise((resolve) => statelessProc.once('exit', resolve)),
    new Promise((resolve) => statefulProc.once('exit', resolve)),
  ])
})

test('stateless: MCP-Protocol-Version header on follow-up request is accepted', async () => {
  const sessionId = await initializeAndGetProtocolVersion(STATELESS_URL)

  const notifyRes = await fetch(STATELESS_URL, {
    method: 'POST',
    headers: followUpHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  })
  assert.strictEqual(notifyRes.status, 202)

  const toolsRes = await fetch(STATELESS_URL, {
    method: 'POST',
    headers: followUpHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  })
  assert.strictEqual(toolsRes.status, 200)
  const body = await toolsRes.text()
  assert.ok(body.includes('"name":"add"'))
})

test('stateful: MCP-Protocol-Version header on follow-up request is accepted', async () => {
  const sessionId = await initializeAndGetProtocolVersion(STATEFUL_URL)
  assert.ok(sessionId, 'stateful mode should issue an mcp-session-id')

  const notifyRes = await fetch(STATEFUL_URL, {
    method: 'POST',
    headers: followUpHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  })
  assert.strictEqual(notifyRes.status, 202)

  const toolsRes = await fetch(STATEFUL_URL, {
    method: 'POST',
    headers: followUpHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  })
  assert.strictEqual(toolsRes.status, 200)
  const body = await toolsRes.text()
  assert.ok(body.includes('"name":"add"'))
})
