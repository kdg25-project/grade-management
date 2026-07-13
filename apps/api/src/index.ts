import { app } from "./app";

const port = Number(Bun.env.API_PORT ?? Bun.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

console.log(`API listening on http://localhost:${port}/api`);
