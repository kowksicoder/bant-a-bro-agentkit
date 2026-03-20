import * as dotenv from "dotenv";
import * as readline from "readline";
import { streamText } from "ai";
import {
  createExampleAgent,
  formatToolOutput,
  type ExampleAgent,
  type ExampleMessage,
} from "./lib/agent";

dotenv.config();

/**
 * Run the chatbot in interactive mode.
 *
 * @param agent - Shared agent configuration
 * @returns Promise that resolves when chat session ends
 */
async function runChatMode(agent: ExampleAgent) {
  console.log("Starting chat mode... Type 'exit' to end.");

  if (agent.twitterEnabled) {
    console.log("Twitter tools enabled: post_tweet, get_mentions, reply_to_tweet.");
  } else {
    console.log("Twitter tools disabled. Add Twitter credentials to enable X automation.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  const messages: ExampleMessage[] = [];

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const userInput = await question("\nPrompt: ");
      console.log("-------------------");

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      messages.push({ role: "user", content: userInput });

      const result = streamText({
        model: agent.model,
        messages,
        tools: agent.tools,
        system: agent.system,
        stopWhen: agent.stopWhen,
        onStepFinish: async ({ toolResults }) => {
          for (const tr of toolResults) {
            console.log(`Tool ${tr.toolName}: ${formatToolOutput(tr.output)}`);
          }
        },
      });

      let fullResponse = "";
      for await (const delta of result.textStream) {
        fullResponse += delta;
      }

      if (fullResponse) {
        console.log("\n Response: " + fullResponse);
      }

      messages.push({ role: "assistant", content: fullResponse });
      console.log("-------------------");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    rl.close();
  }
}

/**
 * Run the agent autonomously with specified intervals.
 *
 * @param agent - Shared agent configuration
 * @param interval - Time interval between actions in seconds
 */
async function runAutonomousMode(agent: ExampleAgent, interval = 10) {
  console.log("Starting autonomous mode...");

  const messages: ExampleMessage[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const thought = agent.twitterEnabled
        ? "Be creative and do something interesting using your onchain wallet or Twitter account. Choose an action or set of actions that highlights your abilities."
        : "Be creative and do something interesting onchain. Choose an action or set of actions that highlights your abilities.";

      messages.push({ role: "user", content: thought });

      const result = streamText({
        model: agent.model,
        messages,
        tools: agent.tools,
        system: agent.system,
        stopWhen: agent.stopWhen,
        onStepFinish: async ({ toolResults }) => {
          for (const tr of toolResults) {
            console.log(`Tool ${tr.toolName}: ${formatToolOutput(tr.output)}`);
          }
        },
      });

      let fullResponse = "";
      for await (const delta of result.textStream) {
        fullResponse += delta;
      }

      if (fullResponse) {
        console.log("\n Response: " + fullResponse);
      }

      messages.push({ role: "assistant", content: fullResponse });
      console.log("-------------------");

      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error:", error.message);
      }
      process.exit(1);
    }
  }
}

/**
 * Choose whether to run in autonomous or chat mode based on user input.
 *
 * @returns Selected mode
 */
async function chooseMode(): Promise<"chat" | "auto"> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log("\nAvailable modes:");
    console.log("1. chat    - Interactive chat mode");
    console.log("2. auto    - Autonomous action mode");

    const choice = (await question("\nChoose a mode (enter number or name): "))
      .toLowerCase()
      .trim();

    if (choice === "1" || choice === "chat") {
      rl.close();
      return "chat";
    }

    if (choice === "2" || choice === "auto") {
      rl.close();
      return "auto";
    }

    console.log("Invalid choice. Please try again.");
  }
}

/**
 * Main entry point for the chatbot application.
 */
async function main() {
  try {
    const agent = await createExampleAgent();
    const mode = await chooseMode();

    if (mode === "chat") {
      await runChatMode(agent);
    } else {
      await runAutonomousMode(agent);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  console.log("Starting Agent...");
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
