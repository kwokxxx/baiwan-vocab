import {
  requestJson,
  RequestTimeoutError,
  InvalidResponseError,
} from "./network.ts";
import { parseBackup, type StudyData } from "./study.ts";

export function newBackupCode() {
  return (
    "bw1_" +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function cloudBackup(
  code: string,
  snapshot?: StudyData,
  revision = 0,
) {
  if (!/^bw1_[a-f0-9]{64}$/.test(code))
    throw new Error("恢复码格式不正确，请完整粘贴");
  const { response, value } = await requestJson(
    "/api/backups",
    {
      method: snapshot ? "POST" : "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${code}`,
        ...(snapshot ? { "Content-Type": "application/json" } : {}),
      },
      ...(snapshot ? { body: JSON.stringify({ snapshot, revision }) } : {}),
    },
    undefined,
    15000,
  ).catch((error) => {
    if (error instanceof RequestTimeoutError)
      throw new Error("云备份连接超时，本机记录已保留，请稍后重试。");
    if (error instanceof InvalidResponseError)
      throw new Error("云备份没有返回有效数据，请确认应用已更新。");
    throw new Error("暂时连不上云备份，本机记录已保留，请检查连接后重试。");
  });
  if (!response.ok)
    throw new Error(value.error ?? "云备份暂时不可用，本地记录已保留");
  return {
    revision: Number(value.revision),
    updatedAt: String(value.updatedAt),
    snapshot: value.snapshot ? parseBackup(value.snapshot) : undefined,
  };
}
