import type { IncomingMessage, ServerResponse } from "http";
import { handleWebRequest } from "../web/server";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
  includeFiles: ["web/**", "knowledge/**"],
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleWebRequest(req, res);
}
