import { SqlToolkit } from "langchain/agents/toolkits/sql";
import { DataSource } from "typeorm";
import { SqlDatabase } from "langchain/sql_db";
import { createClient } from "@supabase/supabase-js";
import { GoogleLLM } from "../lib/llms.ts";

const llm = GoogleLLM;

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://your-supabase-url.supabase.co";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-supabase-anon-key";

const supabase = createClient(supabaseUrl, supabaseKey);
// Supabase 연결 테스트
try {
  const { data, error } = await supabase
    .from("certification")
    .select("*")
    .eq("product", "건전지");

  if (error) {
    throw error;
  }

  console.log("Supabase 클라이언트가 성공적으로 연결되었습니다.");
  console.log("data:", data);
} catch (error) {
  console.error("Supabase 연결 중 오류 발생:", error);
  process.exit(1);
}

// console.log(
//   tools
//   // tools.map((tool) => ({
//   //   name: tool.name,
//   //   description: tool.description,
//   // }))
// );

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ALL_TOOLS_LIST as tools } from "./tools.ts";

const agentExecutor = createReactAgent({ llm, tools });

// // saveModelGraphAsPng(agentExecutor, "sqltool/graph.png");

const systemPrompt = `
You are a helpful assistant that can answer questions about the 'kc_certification' of 'product' based on 'certification' table.
Answer Users question based on the following **DB SCHEMA** AND **RULES**.

## RULES:
ALWAYS reply in korean.
ALWAYS search the 'product' and 'category' in 'certification' table using exact match first.
If the search keyword is not found, retry search after removing spaces or adjusting spacing.
ALWAYS SQL query keyword should use \' instead of \".

## DB SCHEMA:
 'id' INTEGER
 'created_at' DATETIME
 'product' TEXT
 'category' TEXT
 'radio_certification' TEXT
 'industry' TEXT
 'condition' TEXT
 'examples' TEXT
 'kc_certification' TEXT

## Example Query:
 완구는 어떤 KC인증을 받아야해?

## Answer:
 완구는 [어린이제품] 카테고리에 속하며 [안전확인] 인증을 받아야합니다.
`;

const exampleQuery = "빙삭기는 어떤 KC인증을 받아야해?";

const events = await agentExecutor.stream(
  {
    messages: [
      ["system", systemPrompt],
      ["user", exampleQuery],
    ],
  },
  { streamMode: "values" }
);

for await (const event of events) {
  console.log("EVENT: ", event);
  const lastMsg = event.messages[event.messages.length - 1];
  if (lastMsg.tool_calls?.length) {
    console.dir(lastMsg.tool_calls, { depth: null });
  } else if (lastMsg.content) {
    console.log(lastMsg.content);
  }
}
