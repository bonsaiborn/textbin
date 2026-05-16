import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import { applyRequestGuards } from "./middleware/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerNotesRoutes } from "./routes/notes.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerShareRoutes } from "./routes/shares.js";
import { getShareByEditSlug, getShareByReadSlug } from "./services/shares.service.js";
import { registerAppErrorHandler } from "./utils/errors.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let cachedSpaTemplate: string | undefined;

function getSpaTemplate(clientRoot: string): string {
  if (cachedSpaTemplate) {
    return cachedSpaTemplate;
  }

  const builtIndexPath = path.join(clientRoot, "index.html");
  if (fs.existsSync(builtIndexPath)) {
    cachedSpaTemplate = fs.readFileSync(builtIndexPath, "utf8");
    return cachedSpaTemplate;
  }

  const sourceIndexPath = path.resolve("src/client/index.html");
  cachedSpaTemplate = fs.readFileSync(sourceIndexPath, "utf8");
  return cachedSpaTemplate;
}

function renderSpaHtml(clientRoot: string, options?: { title?: string; description?: string; imageUrl?: string }): string {
  const template = getSpaTemplate(clientRoot);
  const title = escapeHtml(options?.title ?? "TextBin");
  const description = escapeHtml(options?.description ?? "Private self-hosted plain text vault.");
  const imageUrl = escapeHtml(options?.imageUrl ?? "/og/textbin-og.png");

  return template
    .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta property="og:title" content=".*?" \/>/i, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta name="twitter:title" content=".*?" \/>/i, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="description" content=".*?" \/>/i, `<meta name="description" content="${description}" />`)
    .replace(/<meta property="og:description" content=".*?" \/>/i, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta name="twitter:description" content=".*?" \/>/i, `<meta name="twitter:description" content="${description}" />`)
    .replace(/<meta property="og:image" content=".*?" \/>/i, `<meta property="og:image" content="${imageUrl}" />`)
    .replace(/<meta name="twitter:image" content=".*?" \/>/i, `<meta name="twitter:image" content="${imageUrl}" />`);
}

async function registerStaticRoutes(app: FastifyInstance) {
  const clientRoot = path.resolve("dist/client");
  if (!fs.existsSync(clientRoot)) {
    return;
  }

  await app.register(fastifyStatic, {
    root: clientRoot,
    prefix: "/"
  });

  app.get("/site.webmanifest", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.type("application/manifest+json; charset=utf-8");
    return reply.sendFile("site.webmanifest");
  });
  app.get("/robots.txt", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.type("text/plain; charset=utf-8");
    return reply.sendFile("robots.txt");
  });
  app.get("/favicon.ico", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.sendFile("icons/favicon-32.png");
  });
  app.get("/icons/:file", async (request: FastifyRequest, reply: FastifyReply) => {
    const { file } = request.params as { file: string };
    return reply.sendFile(`icons/${file}`);
  });
  app.get("/og/:file", async (request: FastifyRequest, reply: FastifyReply) => {
    const { file } = request.params as { file: string };
    return reply.sendFile(`og/${file}`);
  });
  app.get("/login", async (_request: FastifyRequest, reply: FastifyReply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
  app.get("/dashboard", async (_request: FastifyRequest, reply: FastifyReply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
  app.get("/s/:slug", async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const share = getShareByReadSlug(slug);
    const title = share?.password_hash
      ? "Protected TextBin Note"
      : share?.filename.replace(/\.txt$/i, "") || "Shared Note";
    const description = share?.password_hash
      ? "Password-protected shared note from TextBin."
      : `Public shared note: ${title}`;
    return reply
      .type("text/html; charset=utf-8")
      .send(renderSpaHtml(clientRoot, { title, description }));
  });
  app.get("/e/:slug", async (request: FastifyRequest, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const share = getShareByEditSlug(slug);
    const title = share?.password_hash ? "Protected Editable TextBin Note" : "Editable TextBin Note";
    const description = share?.password_hash
      ? "Password-protected editable note from TextBin."
      : "Anyone with this link can edit this note.";
    return reply
      .type("text/html; charset=utf-8")
      .send(renderSpaHtml(clientRoot, { title, description }));
  });
  app.get("/", async (_request: FastifyRequest, reply: FastifyReply) => reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot)));
  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.raw.url?.startsWith("/api/")) {
      return reply.type("text/html; charset=utf-8").send(renderSpaHtml(clientRoot));
    }
    return reply.status(404).send({ message: "Not found" });
  });
}

export async function createApp() {
  await initializeDatabase();

  const app = Fastify({
    logger: false,
    bodyLimit: config.maxNoteSize,
    trustProxy: config.trustProxy
  });

  await app.register(cookie, {
    secret: config.appSecret
  });

  app.addHook("onRequest", applyRequestGuards);

  await registerAuthRoutes(app);
  await registerSettingsRoutes(app);
  await registerNotesRoutes(app);
  await registerShareRoutes(app);
  await registerAdminRoutes(app);
  await registerHealthRoutes(app);

  registerAppErrorHandler(app);
  await registerStaticRoutes(app);

  return app;
}
