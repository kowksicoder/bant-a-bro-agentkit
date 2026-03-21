import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { streamText } from "ai";
import { resolveBantahUserContext } from "../lib/bantahContext";
import {
  getBantahKnowledgeFallbackReply,
  isLikelyBantahKnowledgeQuestion,
  isLikelyModelAvailabilityError,
} from "../lib/bantahKnowledgeFallback";
import {
  listSocialIdentityLinksForBantahUser,
  logAgentAuditEvent,
  upsertSocialIdentityLink,
} from "../lib/persistence";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const BANTAH_BOOTSTRAP_TAG = "__BANTABRO_BOOTSTRAP__";

type ExampleMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ExampleAgentModule = typeof import("../lib/agent");

function resolveExistingPath(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const WEB_ROOT = resolveExistingPath(
  path.resolve(process.cwd(), "web"),
  path.resolve(__dirname),
);
const INDEX_FILE = resolveExistingPath(
  path.resolve(WEB_ROOT, "index.html"),
  path.resolve(__dirname, "index.html"),
);

type ChatRequestBody = {
  messages?: ExampleMessage[];
  bantahUserId?: string;
};

type TwitterLinkRequestBody = {
  twitterUserId?: string;
  twitterUsername?: string;
};

type StreamEvent =
  | {
      type: "ready";
      twitterEnabled: boolean;
      bantahEnabled: boolean;
      bantahAuthenticated: boolean;
      bantahUserId?: string | null;
      bantahUsername?: string | null;
    }
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
  const server = createServer(handleWebRequest);

  server.listen(PORT, () => {
    console.log(`Web chat ready at http://localhost:${PORT}`);
  });

  return server;
}

export async function handleWebRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      await serveIndex(req, url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      await handleSessionRequest(req, url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/channel-links/twitter") {
      await handleTwitterLinkListRequest(req, url, res);
      return;
    }

    if (req.method === "GET" && url.pathname !== "/api/chat") {
      if (serveStaticAsset(url.pathname, res)) {
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChatRequest(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/channel-links/twitter") {
      await handleTwitterLinkRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message }));
  }
}

/**
 * Serve the single-page chat interface.
 *
 * @param req - HTTP request
 * @param res - HTTP response
 */
async function serveIndex(req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  const html = fs.readFileSync(INDEX_FILE, "utf8");
  const bantahContext = await resolveBantahUserContext({
    headers: req.headers,
    queryBantahUserId: url.searchParams.get("bantahUserId")?.trim() || undefined,
  });
  const bootstrapPayload = JSON.stringify({
    bantahSession: bantahContext,
    bantahUserId: bantahContext.userId || "",
  }).replace(/</g, "\\u003c");
  const bootstrappedHtml = html.replace(
    "</head>",
    `  <script>window.${BANTAH_BOOTSTRAP_TAG} = ${bootstrapPayload};</script>\n</head>`,
  );
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(bootstrappedHtml);
}

/**
 * Serve a static asset from the local web directory.
 *
 * @param pathname - Request pathname
 * @param res - HTTP response
 * @returns True when an asset was served
 */
function serveStaticAsset(pathname: string, res: ServerResponse): boolean {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relativePath) {
    return false;
  }

  const assetPath = path.resolve(WEB_ROOT, relativePath);
  if (!assetPath.startsWith(WEB_ROOT)) {
    return false;
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    return false;
  }

  const ext = path.extname(assetPath).toLowerCase();
  const contentType = getContentType(ext);
  const body = fs.readFileSync(assetPath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(body);
  return true;
}

/**
 * Map a file extension to a response content type.
 *
 * @param ext - File extension
 * @returns Content type header
 */
function getContentType(ext: string): string {
  switch (ext) {
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
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
  const bantahContext = await resolveBantahUserContext({
    headers: req.headers,
    bodyBantahUserId: typeof body.bantahUserId === "string" ? body.bantahUserId.trim() : undefined,
  });
  const bantahFallbackReply = getBantahKnowledgeFallbackReply(messages, {
    bantahAuthenticated: bantahContext.isAuthenticated,
    bantahUsername: bantahContext.username,
    channel: "web",
  });
  const shouldAttemptKnowledgeOnly =
    (!String(process.env.OPENAI_API_KEY || "").trim() ||
      String(process.env.BANTABRO_FORCE_KNOWLEDGEBASE_MODE || "").trim() === "true") &&
    Boolean(bantahFallbackReply);
  const knowledgeOnlyMode = String(process.env.BANTABRO_FORCE_KNOWLEDGEBASE_MODE || "").trim() === "true";

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  if (shouldAttemptKnowledgeOnly) {
    sendEvent(res, {
      type: "ready",
      twitterEnabled: false,
      bantahEnabled: true,
      bantahAuthenticated: bantahContext.isAuthenticated,
      bantahUserId: bantahContext.userId,
      bantahUsername: bantahContext.username,
    });

    streamFallbackReply(res, bantahFallbackReply!);
    res.end();
    logAgentAuditEvent({
      channel: "web",
      eventType: "bantah_knowledge_fallback_served",
      bantahUserId: bantahContext.userId,
      status: "processed",
      detail: "Served Bantah knowledge base fallback without model call.",
      metadata: {
        reason: "model_not_configured_or_forced_fallback",
        authSource: bantahContext.source,
      },
    });
    return;
  }

  if (knowledgeOnlyMode) {
    const reply =
      bantahFallbackReply ||
      "Bant-A-Bro is currently running in knowledge mode. I can answer Bantah product questions right now, but live wallet and action execution are temporarily unavailable.";

    sendEvent(res, {
      type: "ready",
      twitterEnabled: false,
      bantahEnabled: true,
      bantahAuthenticated: bantahContext.isAuthenticated,
      bantahUserId: bantahContext.userId,
      bantahUsername: bantahContext.username,
    });
    streamFallbackReply(res, reply);
    res.end();
    logAgentAuditEvent({
      channel: "web",
      eventType: "knowledge_mode_reply_served",
      bantahUserId: bantahContext.userId,
      status: "processed",
      detail: "Served knowledge mode reply without loading the live agent runtime.",
      metadata: {
        authSource: bantahContext.source,
      },
    });
    return;
  }

  let agent;
  let formatToolOutput: ExampleAgentModule["formatToolOutput"];
  try {
    const agentModule = (await import("../lib/agent")) as ExampleAgentModule;
    formatToolOutput = agentModule.formatToolOutput;
    agent = await agentModule.createExampleAgent({
      bantahActingAsUserId: bantahContext.userId || undefined,
    });
  } catch (error) {
    if (bantahFallbackReply && isLikelyBantahKnowledgeQuestion(messages)) {
      sendEvent(res, {
        type: "ready",
        twitterEnabled: false,
        bantahEnabled: true,
        bantahAuthenticated: bantahContext.isAuthenticated,
        bantahUserId: bantahContext.userId,
        bantahUsername: bantahContext.username,
      });
      streamFallbackReply(res, bantahFallbackReply);
      res.end();
      logAgentAuditEvent({
        channel: "web",
        eventType: "bantah_knowledge_fallback_served",
        bantahUserId: bantahContext.userId,
        status: "processed",
        detail: error instanceof Error ? error.message : "Agent initialization failed; served fallback.",
        metadata: {
          reason: "agent_initialization_failed",
          authSource: bantahContext.source,
        },
      });
      return;
    }

    sendEvent(res, {
      type: "error",
      message: error instanceof Error ? error.message : "Failed to initialize agent",
    });
    logAgentAuditEvent({
      channel: "web",
      eventType: "chat_turn_failed",
      bantahUserId: bantahContext.userId,
      status: "failed",
      detail: error instanceof Error ? error.message : "Failed to initialize agent",
      metadata: {
        authSource: bantahContext.source,
      },
    });
    res.end();
    return;
  }

  sendEvent(res, {
    type: "ready",
    twitterEnabled: agent.twitterEnabled,
    bantahEnabled: agent.bantahEnabled,
    bantahAuthenticated: bantahContext.isAuthenticated,
    bantahUserId: bantahContext.userId,
    bantahUsername: bantahContext.username,
  });

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
    logAgentAuditEvent({
      channel: "web",
      eventType: "chat_turn_completed",
      bantahUserId: bantahContext.userId,
      status: "processed",
      detail: "Web chat turn completed.",
      metadata: {
        messageCount: messages.length,
        authSource: bantahContext.source,
      },
    });
  } catch (error) {
    if (bantahFallbackReply && isLikelyModelAvailabilityError(error)) {
      streamFallbackReply(res, bantahFallbackReply);
      res.end();
      logAgentAuditEvent({
        channel: "web",
        eventType: "bantah_knowledge_fallback_served",
        bantahUserId: bantahContext.userId,
        status: "processed",
        detail: error instanceof Error ? error.message : "Model unavailable; served Bantah fallback.",
        metadata: {
          reason: "model_unavailable",
          authSource: bantahContext.source,
        },
      });
      return;
    }

    sendEvent(res, {
      type: "error",
      message: error instanceof Error ? error.message : "Chat request failed",
    });
    logAgentAuditEvent({
      channel: "web",
      eventType: "chat_turn_failed",
      bantahUserId: bantahContext.userId,
      status: "failed",
      detail: error instanceof Error ? error.message : "Chat request failed",
      metadata: {
        messageCount: messages.length,
        authSource: bantahContext.source,
      },
    });
  } finally {
    res.end();
  }
}

async function handleSessionRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const bantahContext = await resolveBantahUserContext({
    headers: req.headers,
    queryBantahUserId: url.searchParams.get("bantahUserId")?.trim() || undefined,
  });

  const twitterLinks = bantahContext.userId
    ? listSocialIdentityLinksForBantahUser("twitter", bantahContext.userId)
    : [];

  writeJson(res, 200, {
    authenticated: bantahContext.isAuthenticated,
    bantahSession: bantahContext,
    linkedChannels: {
      twitter: twitterLinks,
    },
  });
}

async function handleTwitterLinkListRequest(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const bantahContext = await resolveBantahUserContext({
    headers: req.headers,
    queryBantahUserId: url.searchParams.get("bantahUserId")?.trim() || undefined,
  });

  if (!bantahContext.userId) {
    writeJson(res, 401, { error: "Bantah sign-in required before listing Twitter links." });
    return;
  }

  writeJson(res, 200, {
    linkedChannels: {
      twitter: listSocialIdentityLinksForBantahUser("twitter", bantahContext.userId),
    },
  });
}

async function handleTwitterLinkRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(req)) as ChatRequestBody & TwitterLinkRequestBody;
  const bantahContext = await resolveBantahUserContext({
    headers: req.headers,
    bodyBantahUserId: typeof body.bantahUserId === "string" ? body.bantahUserId.trim() : undefined,
  });

  if (!bantahContext.userId) {
    writeJson(res, 401, { error: "Bantah sign-in required before linking Twitter." });
    return;
  }

  const twitterUserId = String(body.twitterUserId || "").trim();
  const twitterUsername = String(body.twitterUsername || "").trim();

  if (!twitterUserId && !twitterUsername) {
    writeJson(res, 400, {
      error: "Provide twitterUserId or twitterUsername to link the account.",
    });
    return;
  }

  const link = upsertSocialIdentityLink({
    channel: "twitter",
    externalUserId: twitterUserId || twitterUsername.toLowerCase(),
    externalUsername: twitterUsername || null,
    bantahUserId: bantahContext.userId,
    bantahUsername: bantahContext.username,
    walletAddress: bantahContext.walletAddress,
    metadata: {
      linkedFrom: "agent-web",
      authSource: bantahContext.source,
    },
  });

  logAgentAuditEvent({
    channel: "web",
    eventType: "twitter_identity_linked",
    bantahUserId: bantahContext.userId,
    externalUserId: link.externalUserId,
    externalUsername: link.externalUsername,
    status: "processed",
    detail: `Linked Twitter identity ${link.externalUsername || link.externalUserId}.`,
  });

  writeJson(res, 200, {
    success: true,
    link,
  });
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

function streamFallbackReply(res: ServerResponse, reply: string): void {
  sendEvent(res, { type: "text-delta", delta: reply });
  sendEvent(res, { type: "done", text: reply });
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

if (require.main === module) {
  startServer();
}
