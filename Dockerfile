FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./
RUN npm ci --omit=dev

COPY . ./

CMD ["npm", "start"]
