import * as fs from "fs";
import * as path from "path";

function resolveExistingPath(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const PROJECT_KNOWLEDGE_PATH = resolveExistingPath(
  path.resolve(process.cwd(), "knowledge", "project.md"),
  path.resolve(__dirname, "..", "knowledge", "project.md"),
);
const KNOWLEDGE_SKILLS_DIR = resolveExistingPath(
  path.resolve(process.cwd(), "knowledge", "skills"),
  path.resolve(__dirname, "..", "knowledge", "skills"),
);

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

/**
 * Load all local knowledge-skill markdown files.
 *
 * @returns Array of loaded skill documents
 */
export function loadKnowledgeSkills(): Array<{ name: string; content: string }> {
  try {
    if (!fs.existsSync(KNOWLEDGE_SKILLS_DIR)) {
      return [];
    }

    return fs
      .readdirSync(KNOWLEDGE_SKILLS_DIR)
      .filter(fileName => fileName.endsWith(".md"))
      .sort()
      .map(fileName => {
        const content = fs.readFileSync(path.join(KNOWLEDGE_SKILLS_DIR, fileName), "utf8").trim();

        return {
          name: fileName.replace(/\.md$/, ""),
          content,
        };
      })
      .filter(skill => skill.content.length > 0);
  } catch (error) {
    console.warn("Warning: Failed to load knowledge skills:", error);
    return [];
  }
}

/**
 * Build the knowledge-skills prompt section.
 *
 * @returns Prompt-safe skills block or an empty string
 */
export function buildKnowledgeSkillsPrompt(): string {
  const skills = loadKnowledgeSkills();
  if (skills.length === 0) {
    return "";
  }

  const content = skills.map(skill => `## ${skill.name}\n${skill.content}`).join("\n\n");

  return `Installed knowledge skills:\n${content}`;
}

/**
 * Build the combined knowledge prompt section used by the shared agent.
 *
 * @returns Prompt-safe combined knowledge block
 */
export function buildKnowledgePrompt(): string {
  return [buildProjectKnowledgePrompt(), buildKnowledgeSkillsPrompt()].filter(Boolean).join("\n\n");
}
