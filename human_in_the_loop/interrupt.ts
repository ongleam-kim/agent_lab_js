/*
To use `interrupt` in your graph, you need to:
1. Specify a checkpointer to save the graph state after each step.
2. Call `interrupt()` in the appropriate place. See the Design Patterns section for examples.
3. Run the graph with a thread ID until the interrupt is hit.
4. Resume execution using invoke/stream (see The Command primitive).
*/

import {
  MemorySaver,
  Annotation,
  interrupt,
  Command,
  StateGraph,
} from "@langchain/langgraph";

// Define the graph state
const StateAnnotation = Annotation.Root({
  some_text: Annotation<string>(),
});

function humanNode(state: typeof StateAnnotation.State) {
  const value = interrupt(
    // Any JSON serializable value to surface to the human.
    // For example, a question or a piece of text or a set of keys in the state
    {
      text_to_revise: state.some_text,
    }
  );
  return {
    // Update the state with the human's input
    some_text: value,
  };
}

// Build the graph
const workflow = new StateGraph(StateAnnotation)
  // Add the human-node to the graph
  .addNode("human_node", humanNode)
  .addEdge("__start__", "human_node");

// A checkpointer is required for `interrupt` to work.
const checkpointer = new MemorySaver();
const graph = workflow.compile({
  checkpointer,
});

const threadConfig = { configurable: { thread_id: "some_id" } };

// Using stream() to directly surface the `__interrupt__` information.
for await (const chunk of await graph.stream(
  { some_text: "Original text" },
  threadConfig
)) {
  console.log(chunk);
  console.log("\n====\n");
}

// Resume using Command
for await (const chunk of await graph.stream(
  new Command({ resume: "Edited text" }),
  threadConfig
)) {
  console.log(chunk);
  console.log("\n====\n");
}
