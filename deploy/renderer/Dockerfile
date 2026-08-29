FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /renderer

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY deploy/renderer/package.json ./
RUN npm install --omit=dev

COPY deploy/renderer/server.mjs ./

USER pwuser

EXPOSE 3000

CMD ["node", "server.mjs"]
