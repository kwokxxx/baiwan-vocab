import { betterAuth } from "better-auth";
import { db } from "./db.ts";

export const appOrigin = new URL(
  process.env.BETTER_AUTH_URL ?? "https://vocab-practice-dun.vercel.app",
).origin;
if (!process.env.BETTER_AUTH_SECRET)
  throw new Error("BETTER_AUTH_SECRET is required");
export const auth = betterAuth({
  appName: "百万背单词",
  baseURL: appOrigin,
  secret: process.env.BETTER_AUTH_SECRET,
  database: db,
  trustedOrigins: [appOrigin],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    cookiePrefix: "shici",
    useSecureCookies: appOrigin.startsWith("https:"),
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
  },
});
