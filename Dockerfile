# ARCNAVE container: any Docker host (Oracle Cloud, AWS, Fly.io, Koyeb, Cloud Run...). No npm install needed.
# Step-by-step public deploy on Oracle Cloud Always Free: see DEPLOY.md.
FROM node:24-slim
WORKDIR /app
COPY --chown=node:node . .
# Public mode: debug, dev and save endpoints are refused. S3: the server reads NASA's SPHEREx copy on S3 (us-east-1).
# The cache lives in /data (a Docker volume) so it survives restarts and updates; the demo-cache seed is copied in on start.
ENV NODE_ENV=production PORT=8080 SKYSHIFT_PUBLIC=1 SKYSHIFT_S3=1 SKYSHIFT_S3_PARALLEL=8 \
    SKYSHIFT_CACHE_DIR=/data/cache SKYSHIFT_CACHE_MB=20000
RUN mkdir -p /data/cache && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
