FROM node:24-slim

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev && npm cache clean --force

COPY . .

RUN mkdir -p /data

ENV NODE_ENV=production

CMD ["npm", "run", "start:railway"]
