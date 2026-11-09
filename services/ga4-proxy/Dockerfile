# GA4 中継（Cloud Run）。追加パッケージなし。
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/main.mjs"]
