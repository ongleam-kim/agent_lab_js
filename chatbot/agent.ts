import { ChatTogetherLLM } from "../lib/llms";

const model = ChatTogetherLLM;

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
const StateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  nextRepresentative: Annotation<string>,
  refundAuthorized: Annotation<boolean>,
});

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  SYSTEM_TEMPLATE,
  CATEGORIZATION_SYSTEM_TEMPLATE,
  CATEGORIZATION_HUMAN_TEMPLATE,
} from "./prompts";

const initialSupport = async (state: typeof StateAnnotation.State) => {
  const supportResponse = await model.invoke([
    { role: "system", content: SYSTEM_TEMPLATE },
    ...state.messages,
  ]);

  const categorizationResponse = await model.invoke(
    [
      {
        role: "system",
        content: CATEGORIZATION_SYSTEM_TEMPLATE,
      },
      ...state.messages,
      {
        role: "user",
        content: CATEGORIZATION_HUMAN_TEMPLATE,
      },
    ],
    {
      response_format: {
        type: "json_object",
        schema: zodToJsonSchema(
          z.object({
            nextRepresentative: z.enum(["BILLING", "TECHNICAL", "RESPOND"]),
          })
        ),
      },
    }
  );
  // Some chat models can return complex content, but Together will not
  const categorizationOutput = JSON.parse(
    categorizationResponse.content as string
  );
  // Will append the response message to the current interaction state
  return {
    messages: [supportResponse],
    nextRepresentative: categorizationOutput.nextRepresentative,
  };
};

const billingSupport = async (state: typeof StateAnnotation.State) => {
  const SYSTEM_TEMPLATE = `You are an expert billing support specialist for LangCorp, a company that sells computers.
Help the user to the best of your ability, but be concise in your responses.
You have the ability to authorize refunds, which you can do by transferring the user to another agent who will collect the required information.
If you do, assume the other agent has all necessary information about the customer and their order.
You do not need to ask the user for more information.

Help the user to the best of your ability, but be concise in your responses.`;

  let trimmedHistory = state.messages;
  // Make the user's question the most recent message in the history.
  // This helps small models stay focused.
  if (trimmedHistory.at(-1)._getType() === "ai") {
    trimmedHistory = trimmedHistory.slice(0, -1);
  }

  const billingRepResponse = await model.invoke([
    {
      role: "system",
      content: SYSTEM_TEMPLATE,
    },
    ...trimmedHistory,
  ]);
  const CATEGORIZATION_SYSTEM_TEMPLATE = `Your job is to detect whether a billing support representative wants to refund the user.`;
  const CATEGORIZATION_HUMAN_TEMPLATE = `The following text is a response from a customer support representative.
Extract whether they want to refund the user or not.
Respond with a JSON object containing a single key called "nextRepresentative" with one of the following values:

If they want to refund the user, respond only with the word "REFUND".
Otherwise, respond only with the word "RESPOND".

Here is the text:

<text>
${billingRepResponse.content}
</text>.`;
  const categorizationResponse = await model.invoke(
    [
      {
        role: "system",
        content: CATEGORIZATION_SYSTEM_TEMPLATE,
      },
      {
        role: "user",
        content: CATEGORIZATION_HUMAN_TEMPLATE,
      },
    ],
    {
      response_format: {
        type: "json_object",
        schema: zodToJsonSchema(
          z.object({
            nextRepresentative: z.enum(["REFUND", "RESPOND"]),
          })
        ),
      },
    }
  );
  const categorizationOutput = JSON.parse(
    categorizationResponse.content as string
  );
  return {
    messages: billingRepResponse,
    nextRepresentative: categorizationOutput.nextRepresentative,
  };
};

const technicalSupport = async (state: typeof StateAnnotation.State) => {
  const SYSTEM_TEMPLATE = `You are an expert at diagnosing technical computer issues. You work for a company called LangCorp that sells computers.
Help the user to the best of your ability, but be concise in your responses.`;

  let trimmedHistory = state.messages;
  // Make the user's question the most recent message in the history.
  // This helps small models stay focused.
  if (trimmedHistory.at(-1)._getType() === "ai") {
    trimmedHistory = trimmedHistory.slice(0, -1);
  }

  const response = await model.invoke([
    {
      role: "system",
      content: SYSTEM_TEMPLATE,
    },
    ...trimmedHistory,
  ]);

  return {
    messages: response,
  };
};

import { NodeInterrupt } from "@langchain/langgraph";

const handleRefund = async (state: typeof StateAnnotation.State) => {
  if (!state.refundAuthorized) {
    console.log("--- HUMAN AUTHORIZATION REQUIRED FOR REFUND ---");
    throw new NodeInterrupt("Human authorization required.");
  }
  return {
    messages: {
      role: "assistant",
      content: "Refund processed!",
    },
  };
};

import { StateGraph } from "@langchain/langgraph";

let workflow = new StateGraph(StateAnnotation)
  .addNode("initial_support", initialSupport)
  .addNode("billing_support", billingSupport)
  .addNode("technical_support", technicalSupport)
  .addNode("handle_refund", handleRefund)
  .addEdge("__start__", "initial_support");

workflow = workflow.addConditionalEdges(
  "initial_support",
  async (state: typeof StateAnnotation.State) => {
    if (state.nextRepresentative.includes("BILLING")) {
      return "billing";
    } else if (state.nextRepresentative.includes("TECHNICAL")) {
      return "technical";
    } else {
      return "conversational";
    }
  },
  {
    billing: "billing_support",
    technical: "technical_support",
    conversational: "__end__",
  }
);

console.log("Added edges!");

workflow = workflow
  .addEdge("technical_support", "__end__")
  .addConditionalEdges(
    "billing_support",
    async (state) => {
      if (state.nextRepresentative.includes("REFUND")) {
        return "refund";
      } else {
        return "__end__";
      }
    },
    {
      refund: "handle_refund",
      __end__: "__end__",
    }
  )
  .addEdge("handle_refund", "__end__");

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

// const filePath = "./chatbot/graph.png";
// writeFileSync(filePath, new Uint8Array(arrayBuffer));
// console.log(`그래프 상태가 ${filePath}에 저장되었습니다.`);
// console.log(`MERMAID CODE: \n${mermaid}`);

// --- Run agent (scenario 01) --- //
// const stream = await app.stream(
//   {
//     messages: [
//       {
//         role: "user",
//         content: "I've changed my mind and I want a refund for order #182818!",
//       },
//     ],
//   },
//   {
//     configurable: {
//       thread_id: "refund_testing_id",
//     },
//   }
// );

// for await (const value of stream) {
//   console.log("---STEP---");
//   console.log(value);
//   console.log("---END STEP---");
// }

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
const conversationalStream = await app.stream(
  {
    messages: [
      {
        role: "user",
        content: "How are you? I'm Cobb.",
      },
    ],
  },
  {
    configurable: {
      thread_id: "conversational_testing_id",
    },
  }
);

for await (const value of conversationalStream) {
  console.log(value);
}
