import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { streamText } from "ai";
import { createExampleAgent, formatToolOutput, type ExampleMessage } from "../lib/agent";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const INDEX_FILE = path.resolve(__dirname, "index.html");

type ChatRequestBody = {
  messages?: ExampleMessage[];
};

type StreamEvent =
  | { type: "ready"; twitterEnabled: boolean }
  | { type: "text-delta"; delta: string }
  | { type: "tool-result"; toolName: string; output: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

/**
 * Start the local web server for the chat UI.
 *
 * @returns The created HTTP server
 */
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/") {
        serveIndex(res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        await handleChatRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(PORT, () => {
    console.log(`Web chat ready at http://localhost:${PORT}`);
  });

  return server;
}

/**
 * Serve the single-page chat interface.
 *
 * @param res - HTTP response
 */
function serveIndex(res: ServerResponse): void {
  const html = fs.readFileSync(INDEX_FILE, "utf8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Process a chat request and stream the result back to the browser.
 *
 * @param req - HTTP request
 * @param res - HTTP response
 * @returns Promise that resolves when streaming completes
 */
async function handleChatRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const messages = sanitizeMessages(body.messages);
  const agent = await createExampleAgent();

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  sendEvent(res, { type: "ready", twitterEnabled: agent.twitterEnabled });

  try {
    const result = streamText({
      model: agent.model,
      messages,
      tools: agent.tools,
      system: agent.system,
      stopWhen: agent.stopWhen,
      onStepFinish: async ({ toolResults }) => {
        for (const tr of toolResults) {
          sendEvent(res, {
            type: "tool-result",
            toolName: tr.toolName,
            output: formatToolOutput(tr.output),
          });
        }
      },
    });

    let fullResponse = "";
    for await (const delta of result.textStream) {
      fullResponse += delta;
      sendEvent(res, { type: "text-delta", delta });
    }

    sendEvent(res, { type: "done", text: fullResponse });
  } catch (error) {
    sendEvent(res, {
      type: "error",
      message: error instanceof Error ? error.message : "Chat request failed",
    });
  } finally {
    res.end();
  }
}

/**
 * Parse a JSON request body.
 *
 * @param req - HTTP request
 * @returns Parsed request body
 */
async function readJsonBody(req: IncomingMessage): Promise<ChatRequestBody> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as ChatRequestBody;
}

/**
 * Validate browser-submitted chat messages.
 *
 * @param messages - Candidate messages from the browser
 * @returns Safe messages for the model call
 */
function sanitizeMessages(messages: ChatRequestBody["messages"]): ExampleMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(message => {
      return (
        message &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant" || message.role === "system") &&
        typeof message.content === "string"
      );
    })
    .map(message => ({
      role: message.role,
      content: message.content,
    }));
}

/**
 * Send a newline-delimited JSON event to the browser stream.
 *
 * @param res - HTTP response
 * @param event - Event payload
 */
function sendEvent(res: ServerResponse, event: StreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`);
}

if (require.main === module) {
  startServer();
}
