FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
COPY ../frontend ./frontend
EXPOSE 8080
CMD ["npm", "start"]
