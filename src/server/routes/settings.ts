import type { FastifyInstance } from "fastify";
import { getInstanceSettings } from "../db.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async (_request, reply) => {
    return reply.send({ settings: getInstanceSettings() });
  });
}
