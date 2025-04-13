import { ChatAnthropic } from "@langchain/anthropic";
import { ChatTogetherAI } from "@langchain/community/chat_models/togetherai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import dotenv from "dotenv";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { PROMPT } from "./prompts";

dotenv.config({ path: ".env.local" });

// const model = new ChatAnthropic({
//   model: "claude-3-haiku-20240307",
//   temperature: 0,
// });

const model = new ChatTogetherAI({
  model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
  temperature: 0,
});

const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  nextRepresentative: Annotation<string>,
  refundAuthorized: Annotation<boolean>,
});

const initialSupport = async (state: typeof StateAnnotation.State) => {
  const supportResponse = await model.invoke([
    { role: "system", content: PROMPT.init.system },
    ...state.messages,
  ]);

  const routingResponse = await model.invoke(
    [
      {
        role: "system",
        content: PROMPT.routing.system,
      },
      ...state.messages,
      {
        role: "user",
        content: PROMPT.routing.system,
      },
    ],

    {
      response_format: {
        type: "json_object",
        schema: zodToJsonSchema(
          z.object({
            nextRepresentative: z.enum(["RESPOND", "CERTIFICATION"]),
          })
        ),
      },
    }
  );
  // Some chat models can return complex content, but Together will not
  const routingOutput = JSON.parse(routingResponse.content as string);
  // Will append the response message to the current interaction state
  return {
    messages: [supportResponse],
    nextRepresentative: routingOutput.nextRepresentative,
  };
};

const certificationSupport = async (state: typeof StateAnnotation.State) => {
  let trimmedHistory = state.messages;
  // Make the user's question the most recent message in the history.
  // This helps small models stay focused.
  if (trimmedHistory.at(-1)._getType() === "ai") {
    trimmedHistory = trimmedHistory.slice(0, -1);
  }

  const response = await model.invoke([
    {
      role: "system",
      content: PROMPT.certification.system,
    },
    ...trimmedHistory,
  ]);

  return {
    messages: response,
  };
};

import { StateGraph } from "@langchain/langgraph";

let workflow = new StateGraph(StateAnnotation)
  .addNode("initial_support", initialSupport)
  .addNode("certification_support", certificationSupport)
  .addEdge("__start__", "initial_support");

workflow = workflow.addConditionalEdges(
  "initial_support",
  async (state: typeof StateAnnotation.State) => {
    if (state.nextRepresentative.includes("CERTIFICATION")) {
      return "certification";
    } else {
      return "conversational";
    }
  },
  {
    certification: "certification_support",
    conversational: "__end__",
  }
);

workflow = workflow.addEdge("certification_support", "__end__");

console.log("Added edges!");

import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();

const app = workflow.compile({
  checkpointer,
});

// --- Visualizing graph --- //
// import { writeFileSync } from "node:fs";
// const graph = await app.getGraphAsync();

// const mermaid = graph.drawMermaid();
// const image = await graph.drawMermaidPng();

// const arrayBuffer = await image.arrayBuffer();

// const filePath = "./dev/graph.png";
// writeFileSync(filePath, new Uint8Array(arrayBuffer));
// console.log(`그래프 상태가 ${filePath}에 저장되었습니다.`);
// console.log(`MERMAID CODE: \n${mermaid}`);

// --- Run agent (scenario 01) --- //
const stream = await app.stream(
  {
    messages: [
      {
        role: "user",
        content: "hey my name is Tom Kim how are you??",
      },
    ],
  },
  {
    configurable: {
      thread_id: "certification_test_id",
    },
  }
);

for await (const value of stream) {
  console.log("---STEP---");
  console.log(value);
  console.log("---END STEP---");
}

// const currentState = await app.getState({
//   configurable: { thread_id: "refund_testing_id" },
// });
// console.log("CURRENT TASKS", JSON.stringify(currentState.tasks, null, 2));

// console.log("NEXT TASKS", currentState.next);

// await app.updateState(
//   { configurable: { thread_id: "refund_testing_id" } },
//   {
//     refundAuthorized: true,
//   }
// );

// const resumedStream = await app.stream(null, {
//   configurable: { thread_id: "refund_testing_id" },
// });

// for await (const value of resumedStream) {
//   console.log(value);
// }

// --- Run agent (scenario 02) --- //
// const technicalStream = await app.stream(
//   {
//     messages: [
//       {
//         role: "user",
//         content:
//           "My LangCorp computer isn't turning on because I dropped it in water.",
//       },
//     ],
//   },
//   {
//     configurable: {
//       thread_id: "technical_testing_id",
//     },
//   }
// );

// for await (const value of technicalStream) {
//   console.log(value);
// }

// --- Run agent (scenario 03: Conversation) --- //
// const conversationalStream = await app.stream(
//   {
//     messages: [
//       {
//         role: "user",
//         content: "How are you? I'm Cobb.",
//       },
//     ],
//   },
//   {
//     configurable: {
//       thread_id: "conversational_testing_id",
//     },
//   }
// );

// for await (const value of conversationalStream) {
//   console.log(value);
// }
