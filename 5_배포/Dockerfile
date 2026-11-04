# 미니워존 서버 이미지 (외부 패키지 없음 · Node 내장 SQLite 사용)
# 빌드: 프로젝트 폴더에서  docker build -f 5_배포/Dockerfile -t miniwarzone .
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/miniwarzone.db
COPY package.json ./
COPY 4_서버 ./4_서버
COPY 3_게임 ./3_게임
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "4_서버/server.js"]
