import {
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";

const StateAnnotation = Annotation.Root({
  input: Annotation<string>,
  userFeedback: Annotation<string>,
});

const step1 = (_state: typeof StateAnnotation.State) => {
  console.log("---Step 1---");
  return {};
};

const humanFeedback = (_state: typeof StateAnnotation.State) => {
  console.log("--- humanFeedback ---");
  const feedback: string = interrupt("Please provide feedback");
  return {
    userFeedback: feedback,
  };
};

const step3 = (_state: typeof StateAnnotation.State) => {
  console.log("---Step 3---");
  return {};
};

const builder = new StateGraph(StateAnnotation)
  .addNode("step1", step1)
  .addNode("humanFeedback", humanFeedback)
  .addNode("step3", step3)
  .addEdge(START, "step1")
  .addEdge("step1", "humanFeedback")
  .addEdge("humanFeedback", "step3")
  .addEdge("step3", END);

// Set up memory
const memory = new MemorySaver();

// Add
const graph = builder.compile({
  checkpointer: memory,
});

// Input
const initialInput = { input: "hello world" };

// Thread
const config = { configurable: { thread_id: "1" } };

// Run the graph until the first interruption
for await (const event of await graph.stream(initialInput, config)) {
  console.log(event);
}

// Will log when the graph is interrupted, after step 2.
console.log("--- GRAPH INTERRUPTED ---");

import { Command } from "@langchain/langgraph";

// Continue the graph execution
for await (const event of await graph.stream(
  new Command({ resume: "go to step 1! " }),
  config
)) {
  console.log(event);
  console.log("\n====\n");
}

console.log((await graph.getState(config)).values);
