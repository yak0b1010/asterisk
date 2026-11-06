FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Mock is OFF in the appliance image
ENV VITE_USE_MOCK=false VITE_API_URL=/api
RUN npm run build

FROM nginx:1.27-alpine
# nginx renders templates with envsubst at start
ENV BACKEND_URL=http://backend:8000
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
