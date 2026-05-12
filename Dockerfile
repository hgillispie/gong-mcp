FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install 2>&1

COPY . .

RUN npm run build 2>&1

EXPOSE ${PORT:-8080}

CMD ["node", "dist/index.js"]