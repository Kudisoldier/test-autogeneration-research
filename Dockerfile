FROM node:20-alpine AS base

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/

RUN npm ci && cd client && npm ci

COPY . .

EXPOSE 3000 3001

CMD ["npm", "run", "dev"]
