import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env.local") });

const supabaseUrl = "https://flsecsynvwerloabcewf.supabase.co";
const supabaseKey = process.env.SUPABASE_ACCESS_TOKEN;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getTables() {
  try {
    const { data, error } = await supabase.rpc("get_tables").select("*");

    if (error) {
      console.error("RPC 에러:", error.message);
      // RPC가 실패하면 raw query를 시도
      const { data: rawData, error: rawError } = await supabase
        .from("pg_tables")
        .select("tablename")
        .eq("schemaname", "public");

      if (rawError) throw rawError;

      console.log("데이터베이스 테이블 목록:");
      rawData.forEach((table) => {
        console.log(`- ${table.tablename}`);
      });
      return;
    }

    console.log("데이터베이스 테이블 목록:");
    data.forEach((table) => {
      console.log(`- ${table.table_name}`);
    });
  } catch (error) {
    console.error("에러 발생:", error.message);
  }
}

getTables();
