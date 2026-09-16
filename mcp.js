/**
 * MCP server: the same plan drop, for a client that can call tools.
 *
 * ## What this adds, and what it does not
 *
 * Nothing here can do anything the public drop API cannot. `submit_plan` is
 * `POST /api/sessions/:pushId/plans` with a schema on the front, and the same
 * session id authorises both. This is a nicer way in, not a privileged one.
 *
 * What it buys is the size of the prompt. Without a connector the app has to
 * paste the entire contract — about 15kb of it — into the chat window every
 * time, because a plain chat model has no way to go and read it. With one
 * connected, the model calls `get_plan_format` itself, and the thing the user
 * pastes shrinks to a sentence with a session id in it.
 *
 * ## Why there is no tool for reading anything
 *
 * There is nothing to read. The survey is typed on the device and never sent,
 * so this server has never seen the user's age, conditions or training
 * history, and it could not expose them if it wanted to. That is a property of
 * where the data lives rather than a policy this file enforces — which is the
 * useful kind.
 *
 * It also means the session id keeps granting exactly one thing: writing a
 * plan. A connector that could read would turn a write-only id, pasted into a
 * third-party chat log, into something worth stealing.
 *
 * ## Why it is unauthenticated
 *
 * Because it does not need to be. MCP's own answer is OAuth, and for a server
 * that reads someone's data that is right. Here the session id in the tool call
 * is the capability, exactly as it is for the HTTP endpoint — so connecting
 * this server involves no account, no sign-in, no token to paste into a config
 * file, and no OAuth flow to implement. That is a real feature and not a
 * shortcut: the honest amount of authentication for an endpoint that only
 * accepts a training plan addressed to an id you already hold is none.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { buildLlmsTxt } from './server-lib/planSpec.mjs';
import { DropError, pushPlan } from './sessions.js';

const NAME = 'rack-and-file';
const VERSION = '1.0.0';

/**
 * Build a server instance.
 *
 * One per request. The transport below runs stateless because the process is a
 * Lambda: there is no instance affinity between calls, so a server that held
 * session state would find it missing on the next request to a different
 * instance. Every tool here is a single round trip, so there is nothing that
 * wants to be held open anyway.
 */
function build() {
  const server = new McpServer({ name: NAME, version: VERSION });

  server.registerTool(
    'get_plan_format',
    {
      title: 'Get the plan format',
      description:
        'Returns the complete specification for a Rack & File training plan: the JSON shape, the ' +
        'built-in movement and equipment ids, and the rules a plan must follow. Call this before ' +
        'writing a plan.',
      inputSchema: {},
    },
    () => ({
      // Generated from the same modules the parser uses, so the documentation
      // cannot promise a field the parser rejects.
      content: [{ type: 'text', text: buildLlmsTxt() }],
    }),
  );

  server.registerTool(
    'submit_plan',
    {
      title: 'Submit a training plan',
      description:
        "Sends a finished training plan to the user's Rack & File app, where it appears for review. " +
        'The session id comes from the prompt the user pasted; ask them for it if you do not have ' +
        'one. If the plan is rejected, the error says what is wrong with it — fix it and submit again.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('The session id from the user\'s prompt, formatted like "A1B2C-D3E4F".'),
        plan: z
          .object({})
          .passthrough()
          .describe('The plan object, matching the format from get_plan_format.'),
      },
    },
    async ({ sessionId, plan }) => {
      try {
        const result = await pushPlan(sessionId, { plan });
        return {
          content: [
            {
              type: 'text',
              text:
                `Sent. The app has it as version ${result.version} and is showing it to the user ` +
                `for review. ${result.remaining} more submissions are allowed for this session.`,
            },
          ],
        };
      } catch (error) {
        /*
         * A refusal is returned as tool content with `isError`, not thrown.
         * Thrown errors surface to the client as a protocol failure, which the
         * model cannot act on; this way the reason lands in the conversation
         * where the model can read it and correct its own output — the whole
         * point of submitting through a tool rather than printing JSON.
         */
        const message =
          error instanceof DropError
            ? error.message
            : 'The app could not be reached. Give the user the plan as JSON so they can paste it in.';

        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );

  return server;
}

/**
 * Handle one MCP request.
 *
 * Mounted by `server.js`. Creates a server and transport per request and
 * closes both when the response finishes — the arrangement the SDK documents
 * for stateless HTTP, and the only one that makes sense on Lambda.
 */
export async function handleMcpRequest(req, res) {
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session ids, no server-initiated streams to keep alive.
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    void transport.close();
  });

  try {
    const server = build();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[mcp] ${error?.message ?? 'unknown failure'}`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error.' },
        id: null,
      });
    }
  }
}
