import { createApp } from "./app";
import { auth } from "./auth";

const port = Number(Bun.env.API_PORT ?? Bun.env.PORT ?? 3001);
const app = createApp(auth.handler);

export default {
  port,
  fetch: app.fetch,
};

console.log(`API listening on http://localhost:${port}/api`);
