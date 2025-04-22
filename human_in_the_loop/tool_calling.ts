import {
  MessagesAnnotation,
  StateGraph,
  START,
  END,
  MemorySaver,
  Command,
  interrupt,
} from "@langchain/langgraph";
import { defaultLLM } from "../lib/llms.ts";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { ToolCall } from "@langchain/core/messages/tool";

const weatherSearch = tool(
  (input: { city: string }) => {
    console.log("----");
    console.log(`Searching for: ${input.city}`);
    console.log("----");
    return "Sunny!";
  },
  {
    name: "weather_search",
    description: "Search for the weather",
    schema: z.object({
      city: z.string(),
    }),
  }
);

const model = defaultLLM.bindTools([weatherSearch]);

const callLLM = async (state: typeof MessagesAnnotation.State) => {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
};

const humanReviewNode = async (
  state: typeof MessagesAnnotation.State
): Promise<Command> => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCall = lastMessage.tool_calls![lastMessage.tool_calls!.length - 1];

  const humanReview = interrupt<
    {
      question: string;
      toolCall: ToolCall;
    },
    {
      action: string;
      data: any;
    }
  >({
    question: "Is this correct?",
    toolCall: toolCall,
  });

  const reviewAction = humanReview.action;
  const reviewData = humanReview.data;

  if (reviewAction === "continue") {
    return new Command({ goto: "run_tool" });
  } else if (reviewAction === "update") {
    const updatedMessage = {
      role: "ai",
      content: lastMessage.content,
      tool_calls: [
        {
          id: toolCall.id,
          name: toolCall.name,
          args: reviewData,
        },
      ],
      id: lastMessage.id,
    };
    return new Command({
      goto: "run_tool",
      update: { messages: [updatedMessage] },
    });
  } else if (reviewAction === "feedback") {
    const toolMessage = new ToolMessage({
      name: toolCall.name,
      content: reviewData,
      tool_call_id: toolCall.id!,
    });
    return new Command({
      goto: "call_llm",
      update: { messages: [toolMessage] },
    });
  }
  throw new Error("Invalid review action");
};

const runTool = async (state: typeof MessagesAnnotation.State) => {
  const newMessages: ToolMessage[] = [];
  const tools = { weather_search: weatherSearch };
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls!;

  for (const toolCall of toolCalls) {
    const tool = tools[toolCall.name as keyof typeof tools];
    const result = await tool.invoke(toolCall.args as any);
    newMessages.push(
      new ToolMessage({
        name: toolCall.name,
        content: result,
        tool_call_id: toolCall.id!,
      })
    );
  }
  return { messages: newMessages };
};

const routeAfterLLM = (
  state: typeof MessagesAnnotation.State
): typeof END | "human_review_node" => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (!lastMessage.tool_calls?.length) {
    return END;
  }
  return "human_review_node";
};

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("call_llm", callLLM)
  .addNode("run_tool", runTool)
  .addNode("human_review_node", humanReviewNode, {
    ends: ["run_tool", "call_llm"],
  })
  .addEdge(START, "call_llm")
  .addConditionalEdges("call_llm", routeAfterLLM, ["human_review_node", END])
  .addEdge("run_tool", "call_llm");

const memory = new MemorySaver();

const graph = workflow.compile({ checkpointer: memory });

// 1st run (w/o review)
console.log("🏃 RUN #1: w/o review");
console.log("=".repeat(80) + "\n");

let inputs = { messages: [{ role: "user", content: "hi!" }] };
let config = {
  configurable: { thread_id: "1" },
  streamMode: "values" as const,
};

let stream = await graph.stream(inputs, config);

for await (const event of stream) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[1] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[1] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}

let state = await graph.getState(config);
console.log(`[NEXT STATE]: ${state.next}\n`);
console.log("=".repeat(80) + "\n");

// 2nd run (approve tool call)
console.log("🏃 RUN #2: approve tool call");
console.log("=".repeat(80) + "\n");

inputs = {
  messages: [{ role: "user", content: "what's the weather in San Francisco?" }],
};
config = { configurable: { thread_id: "2" }, streamMode: "values" as const };

stream = await graph.stream(inputs, config);

for await (const event of stream) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[1] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[1] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}
state = await graph.getState(config);
console.log(`[NEXT STATE]: ${state.next}\n`);

for await (const event of await graph.stream(
  new Command({ resume: { action: "continue" } }),
  config
)) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[2] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[2] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}
console.log("=".repeat(80) + "\n");

// 4th run (Edit tool call)
console.log("🏃 RUN #4: update");
console.log("=".repeat(80) + "\n");

inputs = {
  messages: [{ role: "user", content: "what's the weather in sf?" }],
};
config = { configurable: { thread_id: "3" }, streamMode: "values" as const };

stream = await graph.stream(inputs, config);

for await (const event of stream) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[1] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[1] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}

state = await graph.getState(config);
console.log(`[NEXT STATE]: ${state.next}\n`);

for await (const event of await graph.stream(
  new Command({
    resume: {
      action: "update",
      data: { city: "San Francisco" },
    },
  }),
  config
)) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[2] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[2] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}

// 5th run
console.log("🏃 RUN #5: feedback");
console.log("=".repeat(80) + "\n");

inputs = { messages: [{ role: "user", content: "what's the weather in SF?" }] };
config = { configurable: { thread_id: "4" }, streamMode: "values" as const };

stream = await graph.stream(inputs, config);

for await (const event of stream) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[1] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[1] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}
state = await graph.getState(config);
console.log(`[NEXT STATE]: ${state.next}\n`);

for await (const event of await graph.stream(
  new Command({
    resume: {
      action: "feedback",
      data: "User requested changes: use <city, country> format for location",
    },
  }),
  config
)) {
  const recentMsg = event.messages[event.messages.length - 1];
  if (recentMsg._getType() === "ai" && recentMsg.content[0]?.functionCall) {
    console.log(
      `[2] ${recentMsg._getType()} Message:`,
      JSON.stringify(recentMsg.content[0].functionCall, null, 2)
    );
  } else {
    console.log(`[2] ${recentMsg._getType()} Message:`, recentMsg.content);
  }
}
state = await graph.getState(config);
console.log(`[NEXT STATE]: ${state.next}\n`);

for await (const event of await graph.stream(
  new Command({
    resume: {
      action: "continue",
    },
  }),
  config
)) {
  const recentMsg = event.messages[event.messages.length - 1];
  console.log(`[3] ${recentMsg._getType()} Message:`, recentMsg.content);
}

console.log("=".repeat(80) + "\n");
