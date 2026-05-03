FROM node:20-alpine

RUN apk add --no-cache ffmpeg openssl

WORKDIR /app

# Copy package files + Prisma schema first so postinstall can generate client
COPY package*.json ./
COPY prisma ./prisma

# Install with all deps (skip postinstall, we'll run it after schema is in place — actually schema already copied above so postinstall works)
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app source
COPY . .

RUN mkdir -p uploads

# Use start script which runs prisma db push then node
CMD ["npm", "start"]
