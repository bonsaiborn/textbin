import type { FastifyReply, FastifyRequest } from "fastify";

export function openSseStream(request: FastifyRequest, reply: FastifyReply, onClose: () => void, heartbeatMs = 15000) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  reply.raw.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    reply.raw.write(": ping\n\n");
  }, heartbeatMs);

  const cleanup = () => {
    clearInterval(heartbeat);
    onClose();
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  };

  request.raw.on("close", cleanup);

  return {
    send(data: unknown) {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close: cleanup
  };
}
