import * as fs from "fs";
import * as path from "path";

const PROJECT_KNOWLEDGE_PATH = path.resolve(__dirname, "..", "knowledge", "project.md");

/**
 * Load the local project knowledge base used by the shared agent prompt.
 *
 * @returns Markdown knowledge text, or an empty string when unavailable
 */
export function loadProjectKnowledge(): string {
  try {
    if (!fs.existsSync(PROJECT_KNOWLEDGE_PATH)) {
      return "";
    }

    const content = fs.readFileSync(PROJECT_KNOWLEDGE_PATH, "utf8").trim();
    return content;
  } catch (error) {
    console.warn("Warning: Failed to load project knowledge:", error);
    return "";
  }
}

/**
 * Build the project knowledge prompt section.
 *
 * @returns Prompt-safe project knowledge block or an empty string
 */
export function buildProjectKnowledgePrompt(): string {
  const knowledge = loadProjectKnowledge();
  if (!knowledge) {
    return "";
  }

  return `Project knowledge base:\n${knowledge}`;
}
