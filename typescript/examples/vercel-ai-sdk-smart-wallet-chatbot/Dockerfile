FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install && npm cache clean --force

COPY . .

RUN mkdir -p /data

CMD ["npm", "run", "start:railway"]
