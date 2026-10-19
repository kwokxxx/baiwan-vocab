import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db } from "../server/db.ts";
import { resetAccountPassword } from "./lib/reset-password.ts";

async function main() {
  const email = process.argv[2];
  if (!email || process.argv.length !== 3)
    throw new Error(
      "用法：npm run account:reset -- 账号邮箱；密码将在隐藏输入中填写",
    );
  if (!process.stdin.isTTY)
    throw new Error("请在交互终端操作，禁止从命令行参数或日志传递密码");
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log(
    `将重置 ${email} 的密码，并退出该账号的所有会话；词库和学习记录会保留。`,
  );
  const confirm = await prompt.question("请再次输入完整邮箱确认：");
  prompt.close();
  if (confirm.trim().toLowerCase() !== email.trim().toLowerCase())
    throw new Error("已取消，账号未修改");
  const silentOutput = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const secret = createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: true,
  });
  let password = "",
    confirmation = "";
  try {
    process.stdout.write("新密码（10–128 字符，输入不显示）：");
    password = await secret.question("");
    process.stdout.write("\n再次输入新密码：");
    confirmation = await secret.question("");
    process.stdout.write("\n");
  } finally {
    secret.close();
  }
  if (password !== confirmation) throw new Error("两次密码不一致，账号未修改");
  await resetAccountPassword(email, password);
  password = "";
  confirmation = "";
  console.log("密码已重置，所有旧会话已失效。学习记录已保留。");
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error &&
      !/postgres|connect|authentication|ssl/i.test(error.message)
      ? error.message
      : "重置失败，请检查服务端配置",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
