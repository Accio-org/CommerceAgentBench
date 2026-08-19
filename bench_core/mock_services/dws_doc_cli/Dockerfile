# If your environment requires a private mirror, swap the FROM line accordingly.
# e.g. FROM z1l3perl9ntaybxqos.xuanyuan.run/library/oven/bun:1-slim
FROM oven/bun:1-slim

WORKDIR /app

COPY package.json ./
COPY bun.lock* ./
RUN bun install --production

COPY bin/ ./bin/
COPY src/ ./src/
COPY server.js ./
COPY README.md ./
COPY SKILL.md ./

RUN chmod +x ./bin/dws

ENV PORT=3020
ENV NODE_ENV=production
ENV PATH="/app/bin:${PATH}"
ENV DWS_MOCK_HOME="/tmp/dws-mock"

EXPOSE 3020

CMD ["bun", "server.js"]
