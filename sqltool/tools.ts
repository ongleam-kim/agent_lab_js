import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
// ... (기존 import 및 설정 코드) ...
import OpenAI from "openai"; // OpenAI 라이브러리 추가

// OpenAI 클라이언트 생성 함수 (API Key는 환경 변수에서 가져옴)
const createOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 실제 서비스에서는 오류 처리 또는 로깅 강화 필요
    console.warn(
      "OpenAI API Key가 설정되지 않았습니다. 시맨틱 검색이 제한될 수 있습니다."
    );
    return null;
  }
  return new OpenAI({ apiKey });
};

// 사용할 OpenAI 임베딩 모델 및 Supabase RPC 함수 정보
const EMBEDDING_MODEL = "text-embedding-3-small"; // 데이터 생성 시 사용한 모델과 동일하게
const VECTOR_DIMENSION = 1536; // 해당 모델의 벡터 차원
const RPC_FUNCTION_NAME = "match_kc_certs"; // Supabase에 생성한 RPC 함수 이름

// --- 시맨틱 검색 도구 추가 ---
export const semanticSearchSupabaseTool = tool(
  async ({ searchTerm, threshold = 0.3, count = 5 }) => {
    console.log(
      `[INFO] Semantic Search Term: '${searchTerm}', Threshold: ${threshold}, Count: ${count}`
    );
    const openai = createOpenAIClient();
    const supabase = createSupabaseClient(); // Supabase 클라이언트 재사용 또는 재생성

    if (!openai) {
      return "시맨틱 검색 실패: OpenAI 클라이언트를 초기화할 수 없습니다. API Key 설정을 확인하세요.";
    }

    try {
      // 1. 검색어 임베딩 생성
      let queryEmbedding;
      try {
        console.log(`'${searchTerm}'에 대한 임베딩 생성 요청 중...`);
        const embeddingResponse = await openai.embeddings.create({
          input: [searchTerm.replace("\n", " ").trim()], // 간단한 전처리
          model: EMBEDDING_MODEL,
        });
        queryEmbedding = embeddingResponse.data[0]?.embedding;

        if (!queryEmbedding || queryEmbedding.length !== VECTOR_DIMENSION) {
          console.error(
            "임베딩 생성 실패 또는 차원 불일치:",
            embeddingResponse
          );
          throw new Error(
            `임베딩 생성 실패 또는 차원 불일치 (예상: ${VECTOR_DIMENSION})`
          );
        }
        console.log("임베딩 생성 완료.");
      } catch (error) {
        console.error("OpenAI 임베딩 생성 중 오류:", error);
        return `시맨틱 검색 실패: 검색어 임베딩 생성 중 오류 발생 - ${formattingErrorMessage(
          error
        )}`;
      }

      // 2. Supabase RPC 함수 호출
      console.log(`Supabase RPC 함수 '${RPC_FUNCTION_NAME}' 호출 중...`);
      const { data, error } = await supabase.rpc(RPC_FUNCTION_NAME, {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: count,
      });

      if (error) {
        console.error("Supabase RPC 오류:", error);
        throw error; // 에러를 다시 던져서 상위 catch 블록에서 처리
      }

      if (data && data.length > 0) {
        console.log(`시맨틱 검색 성공: ${data.length}개 결과 반환.`);
        // 결과를 JSON 문자열로 반환 (테이블 형식은 LLM이 담당하도록 유도)
        return JSON.stringify(data, null, 2);
      } else {
        console.log("시맨틱 검색 결과 없음.");
        return "시맨틱 검색 결과가 없습니다. 다른 검색어를 시도해보세요.";
      }
    } catch (error) {
      const errorMessage = formattingErrorMessage(error);
      // 네트워크, 권한, 함수 정의 오류 등에 대한 힌트 제공
      let hint = "";
      if (typeof error === "object" && error !== null) {
        const errorStr = JSON.stringify(error);
        if (errorStr.includes("permission denied")) {
          hint = "(힌트: 함수 실행 권한 확인 필요)";
        } else if (
          errorStr.includes("function " + RPC_FUNCTION_NAME + " does not exist")
        ) {
          hint = `(힌트: Supabase에 '${RPC_FUNCTION_NAME}' 함수 생성 및 파라미터 확인 필요)`;
        } else if (errorStr.includes("vector dimensions do not match")) {
          hint = "(힌트: 벡터 차원 불일치 확인 필요)";
        }
      }
      return `시맨틱 검색 중 오류 발생: ${errorMessage} ${hint}`;
    }
  },
  {
    name: "semantic-search-supabase",
    description:
      "주어진 검색어와 의미적으로 유사한 제품의 KC 인증 정보를 데이터베이스에서 검색합니다. 정확한 제품명이 없을 때 유용합니다.",
    schema: z.object({
      searchTerm: z
        .string()
        .describe("의미적으로 유사한 항목을 찾기 위한 검색어"),
      threshold: z
        .number()
        .optional()
        .describe("유사도 임계값 (0~1 사이, 기본값 0.7)"),
      count: z
        .number()
        .int()
        .optional()
        .describe("반환할 최대 결과 개수 (기본값 3)"),
    }),
  }
);

// Supabase 클라이언트 생성 함수
const createSupabaseClient = () => {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://your-supabase-url.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-supabase-anon-key";

  return createClient(supabaseUrl, supabaseKey);
};

const formattingErrorMessage = (error) => {
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object"
      ? JSON.stringify(error)
      : String(error);
  return errorMessage;
};

const supabase = createSupabaseClient();

// 테이블 목록 조회 도구
export const listTablesSupabaseTool = tool(
  async () => {
    try {
      // 실제 구현에서는 Supabase의 정보 스키마를 쿼리하거나
      // 미리 정의된 테이블 목록을 사용할 수 있습니다.
      const { data, error } = await supabase.rpc("get_public_tables");

      if (error) throw error;

      const tables = data.map((table) => table.tablename);
      return tables.join(", ");
    } catch (error) {
      // 오류 객체를 문자열로 변환하여 반환
      const errorMessage = formattingErrorMessage(error);
      return `테이블 목록 조회 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "list-tables-supabase",
    description: "Returns a list of all tables in the database.",
    schema: z.object({}),
  }
);

// 테이블 정보 조회 도구
export const infoTableSupabaseTool = tool(
  async ({ tables }) => {
    console.log(`[INFO] tables: '${tables}'`);
    try {
      const tableList = tables
        .split(",")
        .map((table) => table.trim())
        .filter(Boolean);
      console.log(`[INFO] tableList: '${tables}'`);

      let result = "";

      console.log("tableList: ", tableList);
      for (const table of tableList) {
        // 테이블 존재 여부 확인
        const { data, error } = await supabase.rpc(
          "get_table_column_info", // The name of the function we created
          {
            p_schema_name: "public", // Pass schema name parameter
            p_table_name: table, // Pass table name parameter
          }
        );
        if (error) {
          result += `테이블 '${table}' 정보:\n`;
          result += `오류: ${formattingErrorMessage(error)}\n\n`;
          continue;
        }
        console.log("data: ", data);
        // 테이블 스키마 정보 조회 (간접적인 방법)
        result += `테이블: ${table}\n`;

        // 샘플 데이터를 통해 컬럼 정보 추론
        let tableExists = false; // Assume false initially

        if (error) {
          // Handle specific function call errors if needed
          result += `스키마 정보 조회 오류 (RPC): ${formattingErrorMessage(
            error
          )}\n`;
          // Consider attempting sample data fetch even if schema fails, maybe table exists but function failed?
        } else if (data && data.length > 0) {
          tableExists = true; // We got column info, table exists
          result += `컬럼 정보:\n`;
          data.forEach((col) => {
            const nullableInfo = col.is_nullable === "YES" ? " (nullable)" : "";
            const defaultInfo = col.column_default
              ? ` [default: ${col.column_default}]`
              : "";
            // Use udt_name for user-defined types, fallback to data_type
            const type =
              col.data_type === "USER-DEFINED" && col.udt_name
                ? col.udt_name
                : col.data_type;
            result += `- ${col.column_name}: ${type}${nullableInfo}${defaultInfo}\n`;
          });
          result += `\n`;
        } else {
          result += `테이블이 비어 있습니다.\n\n`;
        }
      }

      return result;
    } catch (error) {
      const errorMessage = formattingErrorMessage(error);
      return `테이블 정보 조회 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "info-table-supabase",
    description:
      "지정된 테이블의 스키마 정보와 샘플 데이터를 반환합니다. 입력은 쉼표로 구분된 테이블 이름 목록입니다.",
    schema: z.object({
      tables: z.string().describe("쉼표로 구분된 테이블 이름 목록"),
    }),
  }
);

export const querySupabaseTool = tool(
  async ({ product }) => {
    console.log("[INFO] PRODUCT (ILIKE Search): ", product);
    const searchTerm = `%${product}%`; // 검색어 앞뒤에 와일드카드 추가

    try {
      const { data, error } = await supabase
        .from("kc_certifications")
        .select(
          "sub_category, certification, certification_type, condition, exception, example" // example 컬럼도 포함하면 유용할 수 있음
        )
        // .eq("sub_category", product); // 기존 eq 대신 ilike 사용
        .ilike("sub_category", searchTerm); // 대소문자 무시 부분 문자열 검색

      if (error) throw error;

      if (data && data.length > 0) {
        console.log(`[INFO] ILIKE Search found ${data.length} results.`);
        return JSON.stringify(data, null, 2);
      } else {
        console.log("[INFO] ILIKE Search found no results.");
        return "해당 제품명을 포함하는 정보를 찾을 수 없습니다."; // 결과 없을 때 메시지
      }
    } catch (error) {
      const errorMessage = formattingErrorMessage(error);
      return `데이터 조회 중 오류 발생 (ILIKE): ${errorMessage}`;
    }
  },
  {
    name: "query-supabase-ilike", // 도구 이름 변경 (구분 위해)
    description:
      "지정한 product 이름을 포함하는(대소문자 무시) 제품 정보를 kc_certifications 테이블에서 조회합니다.",
    schema: z.object({
      product: z
        .string()
        .describe("포함 여부를 조회할 product 이름의 일부 또는 전체"),
    }),
  }
);
// 쿼리 검사 도구
export const queryCheckerSupabaseTool = tool(
  async ({ query }) => {
    try {
      // 실제 구현에서는 LLM을 사용하여 쿼리를 검사하고 수정할 수 있습니다.
      // 여기서는 간단한 예시만 제공합니다.

      const commonErrors = [
        {
          pattern: /NOT IN \(NULL\)/,
          fix: "NULL 값과 함께 NOT IN을 사용하지 마세요.",
        },
        {
          pattern: /UNION\s+SELECT/,
          fix: "중복을 허용하려면 UNION ALL을 사용하세요.",
        },
        {
          pattern: /BETWEEN\s+\d+\s+AND\s+\d+/,
          fix: "BETWEEN은 포함 범위를 사용합니다. 제외 범위가 필요하면 > 및 <를 사용하세요.",
        },
      ];

      let result = query;
      let hasErrors = false;

      for (const error of commonErrors) {
        if (error.pattern.test(query)) {
          hasErrors = true;
          result += `\n\n주의: ${error.fix}`;
        }
      }

      if (!hasErrors) {
        result += "\n\n쿼리에 일반적인 오류가 없습니다.";
      }

      return result;
    } catch (error) {
      // 오류 객체를 문자열로 변환하여 반환
      const errorMessage = formattingErrorMessage(error);
      return `쿼리 검사 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "query-checker-supabase",
    description:
      "SQL 쿼리의 일반적인 오류를 검사하고 수정합니다. 입력은 검사할 SQL 쿼리입니다.",
    schema: z.object({
      query: z.string().describe("검사할 SQL 쿼리"),
    }),
  }
);

// 데이터 삽입 도구
export const insertDataSupabaseTool = tool(
  async ({ table, data }) => {
    try {
      const supabase = createSupabaseClient();

      const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select();

      if (error) throw error;

      return `데이터 삽입 성공: ${JSON.stringify(result, null, 2)}`;
    } catch (error) {
      // 오류 객체를 문자열로 변환하여 반환
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error)
          : String(error);
      return `데이터 삽입 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "insert-data-supabase",
    description:
      "테이블에 데이터를 삽입합니다. 입력은 테이블 이름과 삽입할 데이터입니다.",
    schema: z.object({
      table: z.string().describe("데이터를 삽입할 테이블 이름"),
      data: z.record(z.any()).describe("삽입할 데이터 (키-값 쌍)"),
    }),
  }
);

// 데이터 업데이트 도구
export const updateDataSupabaseTool = tool(
  async ({ table, data, filter }) => {
    try {
      const supabase = createSupabaseClient();

      let query = supabase.from(table).update(data);

      // 필터 조건 적용
      if (filter) {
        Object.entries(filter).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { data: result, error } = await query.select();

      if (error) throw error;

      return `데이터 업데이트 성공: ${JSON.stringify(result, null, 2)}`;
    } catch (error) {
      // 오류 객체를 문자열로 변환하여 반환
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error)
          : String(error);
      return `데이터 업데이트 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "update-data-supabase",
    description:
      "테이블의 데이터를 업데이트합니다. 입력은 테이블 이름, 업데이트할 데이터, 필터 조건입니다.",
    schema: z.object({
      table: z.string().describe("데이터를 업데이트할 테이블 이름"),
      data: z.record(z.any()).describe("업데이트할 데이터 (키-값 쌍)"),
      filter: z.record(z.any()).optional().describe("필터 조건 (키-값 쌍)"),
    }),
  }
);

// 데이터 삭제 도구
export const deleteDataSupabaseTool = tool(
  async ({ table, filter }) => {
    try {
      const supabase = createSupabaseClient();

      let query = supabase.from(table).delete();

      // 필터 조건 적용
      if (filter) {
        Object.entries(filter).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { data, error } = await query.select();

      if (error) throw error;

      return `데이터 삭제 성공: ${JSON.stringify(data, null, 2)}`;
    } catch (error) {
      // 오류 객체를 문자열로 변환하여 반환
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error)
          : String(error);
      return `데이터 삭제 중 오류 발생: ${errorMessage}`;
    }
  },
  {
    name: "delete-data-supabase",
    description:
      "테이블의 데이터를 삭제합니다. 입력은 테이블 이름과 필터 조건입니다.",
    schema: z.object({
      table: z.string().describe("데이터를 삭제할 테이블 이름"),
      filter: z.record(z.any()).optional().describe("필터 조건 (키-값 쌍)"),
    }),
  }
);

// 모든 도구 내보내기
export const ALL_TOOLS_LIST = [
  listTablesSupabaseTool,
  infoTableSupabaseTool,
  querySupabaseTool,
  queryCheckerSupabaseTool,
  semanticSearchSupabaseTool,
  // insertDataSupabaseTool,
  // updateDataSupabaseTool,
  // deleteDataSupabaseTool,
];
