// Set up the tool
import { tool } from "@langchain/core/tools";
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
  MemorySaver,
  Command,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { defaultLLM } from "../lib/llms.ts";

const search = tool(
  (_) => {
    return "It's sunny in San Francisco, but you better look out if you're a Gemini 😈.";
  },
  {
    name: "search",
    description: "Call to surf the web.",
    schema: z.string(),
  }
);

const tools = [search];
const toolNode = new ToolNode<typeof MessagesAnnotation.State>(tools);

// Set up the model
const model = defaultLLM;

const askHumanTool = tool(
  (_) => {
    return "The human said XYZ";
  },
  {
    name: "askHuman",
    description: "Ask the human for input.",
    schema: z.string(),
  }
);

const modelWithTools = model.bindTools([...tools, askHumanTool]);

// Define nodes and conditional edges

// Define the function that determines whether to continue or not
function shouldContinue(
  state: typeof MessagesAnnotation.State
): "action" | "askHuman" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  // If there is no function call, then we finish
  if (lastMessage && !lastMessage.tool_calls?.length) {
    return END;
  }
  // If tool call is askHuman, we return that node
  // You could also add logic here to let some system know that there's something that requires Human input
  // For example, send a slack message, etc
  if (lastMessage.tool_calls?.[0]?.name === "askHuman") {
    console.log("--- ASKING HUMAN ---");
    return "askHuman";
  }
  // Otherwise if it isn't, we continue with the action node
  return "action";
}

// Define the function that calls the model
async function callModel(
  state: typeof MessagesAnnotation.State
): Promise<Partial<typeof MessagesAnnotation.State>> {
  const messages = state.messages;
  const response = await modelWithTools.invoke(messages);
  // We return an object with a messages property, because this will get added to the existing list
  return { messages: [response] };
}

// We define a fake node to ask the human
function askHuman(
  state: typeof MessagesAnnotation.State
): Partial<typeof MessagesAnnotation.State> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCallId = lastMessage.tool_calls?.[0].id;
  const location: string = interrupt("Please provide your location:");
  const newToolMessage = new ToolMessage({
    tool_call_id: toolCallId!,
    content: location,
  });
  return { messages: [newToolMessage] };
}

// Define a new graph
const messagesWorkflow = new StateGraph(MessagesAnnotation)
  // Define the two nodes we will cycle between
  .addNode("agent", callModel)
  .addNode("action", toolNode)
  .addNode("askHuman", askHuman)
  // We now add a conditional edge
  .addConditionalEdges(
    // First, we define the start node. We use `agent`.
    // This means these are the edges taken after the `agent` node is called.
    "agent",
    // Next, we pass in the function that will determine which node is called next.
    shouldContinue
  )
  // We now add a normal edge from `action` to `agent`.
  // This means that after `action` is called, `agent` node is called next.
  .addEdge("action", "agent")
  // After we get back the human response, we go back to the agent
  .addEdge("askHuman", "agent")
  // Set the entrypoint as `agent`
  // This means that this node is the first one called
  .addEdge(START, "agent");

// Setup memory
const messagesMemory = new MemorySaver();

// Finally, we compile it!
// This compiles it into a LangChain Runnable,
// meaning you can use it as you would any other runnable
const messagesApp = messagesWorkflow.compile({
  checkpointer: messagesMemory,
});

// Input
const input = {
  role: "user",
  content:
    "Use the search tool to ask the user where they are, then look up the weather there",
};

// Thread
const config2 = {
  configurable: { thread_id: "3" },
  streamMode: "values" as const,
};

for await (const event of await messagesApp.stream(
  {
    messages: [input],
  },
  config2
)) {
  const recentMsg = event.messages[event.messages.length - 1];
  console.log(
    `================================ ${recentMsg.getType()} Message (1) =================================`
  );
  console.log(recentMsg.content);
}

console.log("next: ", (await messagesApp.getState(config2)).next);

// Continue the graph execution
for await (const event of await messagesApp.stream(
  new Command({ resume: "San Francisco" }),
  config2
)) {
  console.log(event);
  console.log("\n====\n");
}
